import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAdapter, AgentResult } from '../agents/types.js';
import { sumUsage } from '../agents/usage.js';
import type { createJobsRepo, NewJob, Sighting } from '../db/jobs-repo.js';
import type { ProfilesRepo } from '../db/profiles-repo.js';
import type { createSettingsRepo } from '../db/settings-repo.js';
import {
  MAX_EFFORT_CONCURRENCY,
  MAX_EFFORT_SOURCES,
  type Profile,
  type RunKind,
  type Settings,
  type VerificationStatus,
  workersFailedNote,
} from '../domain/types.js';
import { reportedAgent, requestedAgent, selectionLogLine } from '../runs/agent-record.js';
import type { RunHandler } from '../runs/queue.js';
import { outputJsonSchema, DiscoverJobsOutput, type DiscoverJobsResult } from '../tasks/schemas.js';
import { renderPrompt } from '../tasks/prompts.js';
import { canonicalUrl, dedupeKey } from '../verify/canonicalize.js';
import { verifyLink } from '../verify/links.js';

export interface DiscoveryDeps {
  profilesRepo: Pick<ProfilesRepo, 'get'>;
  jobsRepo: ReturnType<typeof createJobsRepo>;
  settingsRepo: ReturnType<typeof createSettingsRepo>;
  adapterFactory: (settings: Settings, kind: RunKind) => AgentAdapter;
  verify?: typeof verifyLink;
}

const VERIFY_CONCURRENCY = 5;
const KNOWN_URLS_LIMIT = 200;

export const DEFAULT_SCOPE =
  'Search all sources. Start with applicant tracking systems (Greenhouse, Lever, Ashby, Workday and similar), ' +
  "then employers' own careers pages, then reputable job boards.";

const SHARED =
  'You are one of five searchers working at the same time; each covers different sources and the app merges ' +
  'the results. Stay inside your sources and leave the rest to the others.';

// Max effort partitions by source family (user decision 9, SOW-0016); claude's WebSearch treats `site:` as
// a hint, so workers can overlap and the shared dedupe removes repeats.
export const MAX_WORKERS: { name: (typeof MAX_EFFORT_SOURCES)[number]; scope: string }[] = [
  {
    name: MAX_EFFORT_SOURCES[0],
    scope: `${SHARED} Your sources: Greenhouse job boards only (boards.greenhouse.io, job-boards.greenhouse.io).`,
  },
  {
    name: MAX_EFFORT_SOURCES[1],
    scope: `${SHARED} Your sources: Lever job boards only (jobs.lever.co, jobs.eu.lever.co).`,
  },
  {
    name: MAX_EFFORT_SOURCES[2],
    scope: `${SHARED} Your sources: Ashby job boards only (jobs.ashbyhq.com).`,
  },
  {
    name: MAX_EFFORT_SOURCES[3],
    scope:
      `${SHARED} Your sources: applicant tracking systems other than Greenhouse, Lever and Ashby (for example ` +
      "Workday, SmartRecruiters, Workable, Recruitee, Personio, Teamtailor) and employers' own careers pages.",
  },
  {
    name: MAX_EFFORT_SOURCES[4],
    scope:
      `${SHARED} Your sources: remote-first and niche job boards that list employer postings. Return the ` +
      'employer or ATS link for each job when the board shows it.',
  },
];


type WorkerOutcome =
  | { ok: true; result: AgentResult; jobs: DiscoverJobsResult['jobs'] }
  | { ok: false; result: AgentResult; error: string };

function parseOutcome(result: AgentResult): WorkerOutcome {
  if (!result.ok) return { ok: false, result, error: `Agent run failed: ${result.error}` };
  const parsed = DiscoverJobsOutput.safeParse(result.output);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      result,
      error: `Agent output did not match schema: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
    };
  }
  return { ok: true, result, jobs: parsed.data.jobs };
}

function list(items: string[]): string {
  return items.length ? items.join(', ') : '(none)';
}

function renderProfile(p: Profile): string {
  return [
    `Target roles: ${list(p.target_roles)}`,
    `Locations: ${list(p.locations)}`,
    `Remote: ${p.remote}`,
    `Seniority: ${p.seniority || '(none)'}`,
    `Keywords: ${list(p.keywords)}`,
    `Excluded companies: ${list(p.excluded_companies)}`,
    `Notes: ${p.notes || '(none)'}`,
  ].join('\n');
}

// Order-preserving map with bounded concurrency; avoids a dependency for one call site.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function createDiscoveryHandler(deps: DiscoveryDeps): RunHandler {
  const { profilesRepo, jobsRepo, settingsRepo, adapterFactory } = deps;
  const verify = deps.verify ?? verifyLink;

  return async (ctx) => {
    const profile = profilesRepo.get(ctx.run.profile_id);
    if (!profile) throw new Error('Profile not found');
    const settings = settingsRepo.getAll();

    const knownUrls = jobsRepo.recentCanonicalUrls(profile.id, KNOWN_URLS_LIMIT);
    const promptVars = {
      profile: renderProfile(profile),
      known_urls: knownUrls.length ? knownUrls.join('\n') : '(none)',
      // Every Max worker gets the same instructions (user decision 4, SOW-0042).
      custom_prompt: ctx.run.custom_prompt ?? '(none)',
    };

    const adapter = adapterFactory(settings, 'discover_jobs');
    ctx.log(`Using adapter ${adapter.id}`);
    const selectionLine = selectionLogLine(adapter);
    if (selectionLine) ctx.log(selectionLine);
    ctx.recordAgent(requestedAgent(adapter));

    const max = ctx.run.effort_mode === 'max';
    const workers = max ? MAX_WORKERS : [{ name: '', scope: DEFAULT_SCOPE }];
    if (max) ctx.log(`Max effort: ${workers.length} workers, up to ${MAX_EFFORT_CONCURRENCY} at a time`);
    // Rendered once: a template error fails the run before any agent starts.
    const { version } = renderPrompt('discover_jobs', { ...promptVars, scope: DEFAULT_SCOPE });
    const notRun = (error: string): WorkerOutcome => ({
      ok: false,
      error,
      result: { ok: false, rawStdout: '', rawStderr: '', exitCode: null, durationMs: 0, error },
    });
    const outcomes = await mapLimit(
      workers.map((w, i) => ({ ...w, n: i + 1 })),
      max ? MAX_EFFORT_CONCURRENCY : 1,
      async (w): Promise<WorkerOutcome> => {
        // After a cancel, workers still waiting for a slot never start.
        if (ctx.signal.aborted) return notRun('Agent run failed: Aborted');
        // A worker must settle, never reject: a rejection would end the run while the other
        // workers' agents keep running.
        try {
          const rendered = renderPrompt('discover_jobs', { ...promptVars, scope: w.scope });
          let cwd = ctx.runDir;
          let onLog = ctx.log;
          if (max) {
            // Each worker writes its own prompt, schema and output files (codex `-o`).
            cwd = join(ctx.runDir, `worker-${w.n}`);
            mkdirSync(cwd, { recursive: true });
            onLog = (line) => ctx.log(`[worker ${w.n}] ${line}`);
            ctx.log(`Worker ${w.n} (${w.name}) started`);
          }
          const result = await adapter.run(
            { kind: 'discover_jobs', prompt: rendered.text, outputSchema: outputJsonSchema('discover_jobs') },
            { timeoutMs: settings.run_timeout_ms, cwd, onLog, signal: ctx.signal },
          );
          return parseOutcome(result);
        } catch (err) {
          return notRun(err instanceof Error ? err.message : String(err));
        }
      },
    );

    const reported = outcomes.map((o) => reportedAgent(o.result)).find((r) => r !== null);
    if (reported) ctx.recordAgent(reported);
    const usage = sumUsage(outcomes.map((o) => o.result.usage));
    if (usage) {
      ctx.recordUsage({
        usage_cost_usd: usage.costUsd ?? null,
        usage_input_tokens: usage.inputTokens ?? null,
        usage_output_tokens: usage.outputTokens ?? null,
      });
    }

    // A Max run keeps what its other workers found (user decision 12); it fails only when all fail.
    const failed = outcomes.flatMap((o, i) => (o.ok ? [] : [{ n: i + 1, error: o.error }]));
    if (max) for (const f of failed) ctx.log(`Worker ${f.n} (${MAX_WORKERS[f.n - 1]!.name}) failed: ${f.error}`);
    if (failed.length === outcomes.length) throw new Error(failed[0]!.error);
    const found = outcomes.flatMap((o) => (o.ok ? o.jobs : []));

    // Past this point the run cannot be cancelled; throws if a cancel or shutdown came first.
    ctx.beginSaving();

    let dead = 0;
    let unverified = 0;
    let duplicates = 0;
    const parseable: { job: (typeof found)[number]; canonical: string }[] = [];
    for (const job of found) {
      let canonical: string;
      try {
        canonical = canonicalUrl(job.url);
      } catch {
        ctx.log(`Skipping unparseable url: ${job.url}`);
        dead++;
        continue;
      }
      // Only web links are fetched and shown; anything else (javascript:, file:, ...) is unusable.
      const { protocol } = new URL(canonical);
      if (protocol !== 'http:' && protocol !== 'https:') {
        ctx.log(`Skipping unsupported url: ${job.url}`);
        dead++;
        continue;
      }
      parseable.push({ job, canonical });
    }

    // Max workers overlap, so the same link can come back several times; check each one once.
    const distinct = [...new Set(parseable.map((e) => e.canonical))];
    const verdicts = new Map(
      await mapLimit(distinct, VERIFY_CONCURRENCY, async (url) => [url, await verify(url)] as const),
    );
    const verified = parseable.map((entry) => ({ ...entry, verdict: verdicts.get(entry.canonical)! }));

    const existing = jobsRepo.existingDedupeKeys(profile.id);
    const seen = new Set<string>();
    // One sighting per known job; Map order keeps the order the agent returned them in.
    const seenAgain = new Map<string, Sighting>();
    const newJobs: NewJob[] = [];
    const statuses: VerificationStatus[] = [];
    const verifiedAt = new Date().toISOString();
    for (const { job, canonical, verdict } of verified) {
      const canonical_url = verdict.status === 'redirected' ? canonicalUrl(verdict.finalUrl) : canonical;
      const fields = { company: job.company, title: job.title, location: job.location };
      // A closed posting often redirects to the company's board; the link the agent returned still
      // names the known job, and the check describes that link (user decision 12, SOW-0040).
      const returnedKey = dedupeKey({ canonical_url: canonical, ...fields });
      const key = existing.has(returnedKey) ? returnedKey : dedupeKey({ canonical_url, ...fields });
      if (existing.has(key) || seen.has(key)) {
        duplicates++;
        if (existing.has(key)) {
          // Only an answer from the site replaces the stored status: a network error also reads as dead,
          // and one outage must not hide every known job (user decision 10, SOW-0040). When several links
          // lead to the same job, the first conclusive check wins.
          const conclusive = verdict.httpStatus !== null && verdict.status !== 'unverified';
          const verification = conclusive ? { status: verdict.status, verified_at: verifiedAt } : null;
          const sighting = seenAgain.get(key);
          if (!sighting) seenAgain.set(key, { dedupe_key: key, verification });
          else if (!sighting.verification) sighting.verification = verification;
        }
        seen.add(key);
        continue;
      }
      seen.add(key);
      statuses.push(verdict.status);
      newJobs.push({
        company: job.company,
        title: job.title,
        location: job.location,
        remote: job.remote,
        url: job.url,
        canonical_url,
        source_site: job.source_site,
        posted_at: job.posted_at,
        salary: job.salary,
        description_excerpt: job.description_excerpt,
        match_reason: job.match_reason,
        fit_checks: job.checks,
        verification_status: verdict.status,
        verified_at: verifiedAt,
        dedupe_key: key,
      });
    }

    const inserted = jobsRepo.insertMany(ctx.run.id, newJobs, [...seenAgain.values()]);
    // Count outcomes only for rows actually stored.
    const storedUrls = new Set(inserted.map((j) => j.dedupe_key));
    newJobs.forEach((j, i) => {
      if (!storedUrls.has(j.dedupe_key)) return;
      if (statuses[i] === 'dead') dead++;
      else if (statuses[i] === 'unverified') unverified++;
    });

    const failedNote = failed.length ? workersFailedNote(failed.length, outcomes.length) : '';
    const summary = `${inserted.length} new, ${duplicates} duplicates, ${dead} dead, ${unverified} unverified${failedNote}`;
    ctx.log(summary);
    return { summary, promptVersion: version, adapterId: adapter.id };
  };
}
