import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractLastJsonObject, NoJsonFoundError } from '../agents/extract-json.js';
import type { createJobsRepo } from '../db/jobs-repo.js';
import type { ProfilesRepo } from '../db/profiles-repo.js';
import { IMPORT_MAX_JOBS, type Profile } from '../domain/types.js';
import { RUN_INPUT_FILE, type RunHandler } from '../runs/queue.js';
import { renderPrompt } from '../tasks/prompts.js';
import { DiscoverJobsOutput, outputJsonSchema, type DiscoverJobsResult } from '../tasks/schemas.js';
import { verifyLink } from '../verify/links.js';
import { DEFAULT_SCOPE, discoveryPromptVars, savedSummary, saveFoundJobs } from './discovery.js';

// A reply the user pasted, or a result another agent sent, that cannot be imported (mapped to 400).
export class ImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportInputError';
  }
}

// The prompt the app would send its own agent for a Default search, plus the schema an outside agent
// cannot receive as a flag (user decision 2, SOW-0043), so the two never drift apart.
export function renderImportPrompt(
  profile: Profile,
  jobsRepo: Pick<ReturnType<typeof createJobsRepo>, 'recentCanonicalUrls'>,
  customPrompt: string | null,
): { prompt: string; version: string } {
  const rendered = renderPrompt('discover_jobs', {
    ...discoveryPromptVars(profile, jobsRepo, customPrompt),
    scope: DEFAULT_SCOPE,
  });
  const schema = JSON.stringify(outputJsonSchema('discover_jobs'), null, 2);
  const prompt =
    `${rendered.text.trimEnd()}\n\n## Required schema\n\n` +
    `The JSON object must match this JSON Schema:\n\n\`\`\`json\n${schema}\n\`\`\`\n`;
  return { prompt, version: rendered.version };
}

// A pasted reply may wrap the object in prose or code fences, so the last JSON object counts, as with the
// app's own agents (user decision 3, SOW-0043).
export function parseImport(input: { reply: string } | { result: unknown }): DiscoverJobsResult {
  let value: unknown;
  if ('reply' in input) {
    try {
      value = extractLastJsonObject(input.reply);
    } catch (err) {
      if (!(err instanceof NoJsonFoundError)) throw err;
      throw new ImportInputError(
        err.message.startsWith('Last JSON object')
          ? 'The last JSON object in the reply is not valid JSON'
          : 'No JSON object found in the reply',
      );
    }
  } else {
    value = input.result;
  }
  const parsed = DiscoverJobsOutput.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new ImportInputError(`The jobs do not match the expected format: ${where}${issue?.message ?? 'invalid'}`);
  }
  const count = parsed.data.jobs.length;
  if (count === 0) throw new ImportInputError('There are no jobs to import');
  if (count > IMPORT_MAX_JOBS) {
    throw new ImportInputError(`There are ${count} jobs; at most ${IMPORT_MAX_JOBS} can be imported at once`);
  }
  return parsed.data;
}

export interface ImportDeps {
  profilesRepo: Pick<ProfilesRepo, 'get'>;
  jobsRepo: ReturnType<typeof createJobsRepo>;
  verify?: typeof verifyLink;
}

// Saves jobs another agent client found, with the same link checks and dedupe as a discovery run. It runs
// no agent, so it records none (user decision 1, SOW-0043).
export function createImportHandler(deps: ImportDeps): RunHandler {
  const { profilesRepo, jobsRepo } = deps;
  const verify = deps.verify ?? verifyLink;

  return async (ctx) => {
    const profile = profilesRepo.get(ctx.run.profile_id);
    if (!profile) throw new Error('Profile not found');
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(ctx.runDir, RUN_INPUT_FILE), 'utf8'));
    } catch {
      throw new Error('The imported jobs could not be read');
    }
    // Checked when the import was accepted; checked again because the file outlives that request.
    const parsed = DiscoverJobsOutput.safeParse(raw);
    if (!parsed.success) throw new Error('The imported jobs do not match the expected format');
    const found = parsed.data.jobs;
    ctx.log(`Importing ${found.length} ${found.length === 1 ? 'job' : 'jobs'} found by another agent`);

    // Past this point the run cannot be cancelled; throws if a cancel or shutdown came first.
    ctx.beginSaving();
    const summary = savedSummary(await saveFoundJobs(ctx, profile.id, found, { jobsRepo, verify }));
    ctx.log(summary);
    return { summary, adapterId: '' };
  };
}
