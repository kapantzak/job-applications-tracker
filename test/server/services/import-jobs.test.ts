import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createJobsRepo } from '../../../src/server/db/jobs-repo.js';
import { createProfilesRepo, type ProfileInput } from '../../../src/server/db/profiles-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import type { VerificationStatus } from '../../../src/server/domain/types.js';
import { RUN_INPUT_FILE, type RunContext } from '../../../src/server/runs/queue.js';
import { DEFAULT_SCOPE } from '../../../src/server/services/discovery.js';
import {
  createImportHandler,
  ImportInputError,
  parseImport,
  renderImportPrompt,
} from '../../../src/server/services/import-jobs.js';
import { outputJsonSchema } from '../../../src/server/tasks/schemas.js';
import type { verifyLink } from '../../../src/server/verify/links.js';

let db: Db;
let profileId: string;
let jobsRepo: ReturnType<typeof createJobsRepo>;
let profilesRepo: ReturnType<typeof createProfilesRepo>;
let runsRepo: ReturnType<typeof createRunsRepo>;

const PROFILE: ProfileInput = {
  name: 'Backend roles',
  target_roles: ['Backend Engineer'],
  locations: ['Berlin'],
  remote: 'hybrid',
  seniority: 'senior',
  keywords: ['Go'],
  excluded_companies: [],
  notes: 'Visa sponsorship needed',
  mail_filter_kind: 'label',
  mail_filter: '',
};

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  profilesRepo = createProfilesRepo(db);
  jobsRepo = createJobsRepo(db);
  runsRepo = createRunsRepo(db);
  profileId = profilesRepo.create(PROFILE).id;
});

const job = (n: number) => ({ company: `Acme ${n}`, title: `Engineer ${n}`, url: `https://jobs.example.com/${n}` });

describe('parseImport', () => {
  it('takes the last JSON object of a reply with prose and code fences, and fills defaults', () => {
    const reply = [
      'Here is what I found:',
      '```json',
      JSON.stringify({ jobs: [job(1)], notes: 'Few matches' }),
      '```',
      'Good luck!',
    ].join('\n');
    expect(parseImport({ reply })).toEqual({
      jobs: [
        {
          ...job(1),
          location: '',
          remote: 'unknown',
          source_site: '',
          posted_at: null,
          salary: null,
          description_excerpt: '',
          match_reason: '',
          checks: { location: 'unknown', remote: 'unknown', seniority: 'unknown' },
        },
      ],
      notes: 'Few matches',
    });
  });

  it('accepts a result object as sent by an agent', () => {
    expect(parseImport({ result: { jobs: [job(1), job(2)] } }).jobs.map((j) => j.company)).toEqual([
      'Acme 1',
      'Acme 2',
    ]);
  });

  it.each([
    ['a reply without JSON', { reply: 'I could not find any jobs.' }, 'No JSON object found in the reply'],
    ['a reply whose last object does not parse', { reply: '{"jobs": [}' }, 'The last JSON object in the reply is not valid JSON'],
    [
      'a job without a company',
      { result: { jobs: [{ title: 'SRE', url: 'https://jobs.example.com/1' }] } },
      'The jobs do not match the expected format: jobs.0.company: ',
    ],
    ['a result that is not an object', { result: [job(1)] }, 'The jobs do not match the expected format: '],
    ['no jobs', { result: { jobs: [] } }, 'There are no jobs to import'],
    [
      'more than 100 jobs',
      { result: { jobs: Array.from({ length: 101 }, (_, i) => job(i)) } },
      'There are 101 jobs; at most 100 can be imported at once',
    ],
  ])('refuses %s with a clear message', (_name, input, message) => {
    let caught: unknown;
    try {
      parseImport(input);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ImportInputError);
    expect((caught as Error).message.startsWith(message)).toBe(true);
  });

  it('accepts exactly 100 jobs', () => {
    expect(parseImport({ result: { jobs: Array.from({ length: 100 }, (_, i) => job(i)) } }).jobs).toHaveLength(100);
  });
});

describe('renderImportPrompt', () => {
  it('is the v5 discovery prompt for the profile with all sources, the instructions and the schema', () => {
    const run = runsRepo.create('discover_jobs', profileId, { adapter_id: 'claude', prompt_version: '5' });
    jobsRepo.insertMany(run.id, [
      {
        company: 'Acme',
        title: 'SRE',
        location: null,
        remote: 'unknown',
        url: 'https://jobs.example.com/known',
        canonical_url: 'https://jobs.example.com/known',
        source_site: null,
        posted_at: null,
        salary: null,
        description_excerpt: null,
        match_reason: null,
        fit_checks: null,
        verification_status: 'ok',
        verified_at: null,
        dedupe_key: 'k-known',
      },
    ]);
    const { prompt, version } = renderImportPrompt(profilesRepo.get(profileId)!, jobsRepo, 'Only fintech companies');
    expect(version).toBe('5');
    expect(prompt).toContain('Target roles: Backend Engineer');
    expect(prompt).toContain('Notes: Visa sponsorship needed');
    expect(prompt).toContain('https://jobs.example.com/known');
    expect(prompt).toContain(`## Scope\n\n${DEFAULT_SCOPE}`);
    expect(prompt).toContain('<<<INSTRUCTIONS\nOnly fintech companies\nINSTRUCTIONS>>>');
    const schema = /## Required schema\n\nThe JSON object must match this JSON Schema:\n\n```json\n([\s\S]*)\n```\n$/.exec(prompt);
    expect(schema).not.toBeNull();
    expect(JSON.parse(schema![1]!)).toEqual(outputJsonSchema('discover_jobs'));
  });

  it('says (none) when there are no instructions', () => {
    const { prompt } = renderImportPrompt(profilesRepo.get(profileId)!, jobsRepo, null);
    expect(prompt).toContain('<<<INSTRUCTIONS\n(none)\nINSTRUCTIONS>>>');
  });
});

describe('import handler', () => {
  let logs: string[];
  let events: string[];

  function ctx(input: unknown | undefined): RunContext {
    const run = runsRepo.create('import_jobs', profileId, { adapter_id: '', prompt_version: null });
    const runDir = mkdtempSync(join(tmpdir(), 'import-'));
    if (input !== undefined) writeFileSync(join(runDir, RUN_INPUT_FILE), JSON.stringify(input));
    return {
      run,
      log: (l) => logs.push(l),
      signal: new AbortController().signal,
      runDir,
      recordAgent: () => events.push('recordAgent'),
      recordUsage: () => events.push('recordUsage'),
      beginSaving: () => events.push('beginSaving'),
    };
  }

  function handler(statuses: Record<string, VerificationStatus> = {}) {
    const verify = (async (url: string) => {
      events.push(`verify ${url}`);
      return { status: statuses[url] ?? 'ok', finalUrl: url, httpStatus: 200 };
    }) as typeof verifyLink;
    return createImportHandler({ profilesRepo, jobsRepo, verify });
  }

  beforeEach(() => {
    logs = [];
    events = [];
  });

  it('checks links and saves new jobs under the import run, recording no agent', async () => {
    const c = ctx({ jobs: [job(1), job(2)], notes: '' });
    const res = await handler({ 'https://jobs.example.com/2': 'dead' })(c);
    expect(res).toEqual({ summary: '2 new, 0 duplicates, 1 dead, 0 unverified', adapterId: '' });
    expect(events[0]).toBe('beginSaving');
    expect(events).not.toContain('recordAgent');
    expect(events).not.toContain('recordUsage');
    const saved = jobsRepo.list(profileId, { includeDead: true });
    expect(saved.map((j) => [j.company, j.run_id, j.run_kind, j.verification_status]).sort()).toEqual([
      ['Acme 1', c.run.id, 'import_jobs', 'ok'],
      ['Acme 2', c.run.id, 'import_jobs', 'dead'],
    ]);
    expect(logs).toEqual(['Importing 2 jobs found by another agent', res.summary]);
  });

  it('records a known job as seen again by the import instead of saving it twice', async () => {
    await handler()(ctx({ jobs: [job(1)] }));
    const second = ctx({ jobs: [job(1), job(3)] });
    const res = await handler()(second);
    expect(res.summary).toBe('1 new, 1 duplicates, 0 dead, 0 unverified');
    const known = jobsRepo.list(profileId).find((j) => j.company === 'Acme 1')!;
    expect(known.last_seen_run_id).toBe(second.run.id);
  });

  it('fails without saving when the stored input is missing or no longer valid', async () => {
    await expect(handler()(ctx(undefined))).rejects.toThrow('The imported jobs could not be read');
    await expect(handler()(ctx({ jobs: [{ title: 'No company' }] }))).rejects.toThrow(
      'The imported jobs do not match the expected format',
    );
    expect(events).not.toContain('beginSaving');
    expect(jobsRepo.list(profileId, { includeDead: true })).toEqual([]);
  });
});
