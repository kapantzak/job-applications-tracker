import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentResult } from '../../../src/server/agents/types.js';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createJobsRepo } from '../../../src/server/db/jobs-repo.js';
import { createProfilesRepo, type ProfileInput } from '../../../src/server/db/profiles-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { createSettingsRepo } from '../../../src/server/db/settings-repo.js';
import type { VerificationStatus } from '../../../src/server/domain/types.js';
import type { RunContext } from '../../../src/server/runs/queue.js';
import { createDiscoveryHandler } from '../../../src/server/services/discovery.js';
import type { verifyLink } from '../../../src/server/verify/links.js';

let db: Db;
let profilesRepo: ReturnType<typeof createProfilesRepo>;
let profileId: string;
let jobsRepo: ReturnType<typeof createJobsRepo>;
let settingsRepo: ReturnType<typeof createSettingsRepo>;
let runsRepo: ReturnType<typeof createRunsRepo>;
let logs: string[];
let adapterCalls: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  profilesRepo = createProfilesRepo(db);
  jobsRepo = createJobsRepo(db);
  settingsRepo = createSettingsRepo(db);
  runsRepo = createRunsRepo(db);
  logs = [];
  adapterCalls = 0;
});

const PROFILE: ProfileInput = {
  name: 'Backend roles',
  target_roles: ['Backend Engineer'],
  locations: ['Berlin'],
  remote: 'hybrid',
  seniority: 'senior',
  keywords: [],
  excluded_companies: [],
  notes: '',
};

// Later ctx() calls create runs for the profile saved last.
function saveProfile(input: ProfileInput = PROFILE): string {
  profileId = profilesRepo.create(input).id;
  return profileId;
}

function job(n: number, extra: Record<string, unknown> = {}) {
  return { company: `Acme ${n}`, title: `Engineer ${n}`, url: `https://jobs.example.com/${n}`, ...extra };
}

function makeHandler(
  result: AgentResult,
  statuses: Record<string, VerificationStatus> = {},
  overrides: Partial<AgentAdapter> = {},
) {
  const adapter: AgentAdapter = {
    id: 'custom',
    check: async () => ({ id: 'custom', installed: true }),
    listModels: async () => ({ source: 'unavailable', models: [], efforts: [] }),
    run: async () => {
      adapterCalls++;
      return result;
    },
    ...overrides,
  };
  const verify = (async (url: string) => ({
    status: statuses[url] ?? 'ok',
    finalUrl: url,
    httpStatus: 200,
  })) as typeof verifyLink;
  return createDiscoveryHandler({ profilesRepo, jobsRepo, settingsRepo, adapterFactory: () => adapter, verify });
}

function okResult(jobs: unknown[]): AgentResult {
  return { ok: true, output: { jobs }, rawStdout: '', rawStderr: '', exitCode: 0, durationMs: 1 };
}

function ctx(): RunContext {
  const run = runsRepo.create('discover_jobs', profileId, { adapter_id: 'custom', prompt_version: null });
  return {
    run,
    log: (l) => logs.push(l),
    signal: new AbortController().signal,
    runDir: mkdtempSync(join(tmpdir(), 'discovery-')),
    recordAgent: (record) => runsRepo.update(run.id, record),
    beginSaving: () => {},
  };
}

describe('discovery handler', () => {
  it('stores verified jobs', async () => {
    saveProfile();
    const res = await makeHandler(okResult([job(1), job(2)]))(ctx());
    expect(res.summary).toBe('2 new, 0 duplicates, 0 dead, 0 unverified');
    expect(res.promptVersion).toBeTruthy();
    expect(res.adapterId).toBe('custom');
    expect(jobsRepo.list(profileId)).toHaveLength(2);
    expect(logs).toContain('Using adapter custom');
    expect(logs).toContain(res.summary);
  });

  it('records the requested model and effort and the reported model on the run', async () => {
    saveProfile();
    const c = ctx();
    await makeHandler({ ...okResult([job(1)]), reportedModel: 'model-a' }, {}, {
      id: 'claude',
      selection: { model: 'opus', effort: '' },
    })(c);
    expect(runsRepo.get(c.run.id)).toMatchObject({
      adapter_id: 'claude',
      agent_model: 'opus',
      agent_effort: '',
      agent_model_reported: 'model-a',
    });
    expect(logs).toContain('Model: opus, effort: agent default');
  });

  it('keeps the model record when the agent run fails', async () => {
    saveProfile();
    const c = ctx();
    const failed: AgentResult = { ...okResult([]), ok: false, error: 'Exited with code 1', reportedModel: 'model-b' };
    const handler = makeHandler(failed, {}, { id: 'claude', selection: { model: '', effort: 'max' } });
    await expect(handler(c)).rejects.toThrow('Agent run failed: Exited with code 1');
    expect(runsRepo.get(c.run.id)).toMatchObject({
      adapter_id: 'claude',
      agent_model: '',
      agent_effort: 'max',
      agent_model_reported: 'model-b',
    });
  });

  it('records no model or effort for a custom command', async () => {
    saveProfile();
    const c = ctx();
    await makeHandler(okResult([job(1)]))(c);
    expect(runsRepo.get(c.run.id)).toMatchObject({
      adapter_id: 'custom',
      agent_model: null,
      agent_effort: null,
      agent_model_reported: null,
    });
    expect(logs.some((l) => l.startsWith('Model:'))).toBe(false);
  });

  it('skips jobs whose key already exists and duplicates in the batch', async () => {
    saveProfile();
    const c = ctx();
    await makeHandler(okResult([job(1)]))(c);
    const res = await makeHandler(okResult([job(1), job(2), job(2)]))(ctx());
    expect(res.summary).toBe('1 new, 2 duplicates, 0 dead, 0 unverified');
    expect(jobsRepo.list(profileId)).toHaveLength(2);
  });

  it('stores dead jobs and counts them', async () => {
    saveProfile();
    const res = await makeHandler(okResult([job(1), job(2)]), {
      'https://jobs.example.com/1': 'dead',
      'https://jobs.example.com/2': 'unverified',
    })(ctx());
    expect(res.summary).toBe('2 new, 0 duplicates, 1 dead, 1 unverified');
    const dead = jobsRepo.list(profileId, { includeDead: true }).find((j) => j.url.endsWith('/1'));
    expect(dead?.verification_status).toBe('dead');
  });

  it('uses the final url for redirected jobs', async () => {
    saveProfile();
    const adapter: AgentAdapter = {
      id: 'custom',
      check: async () => ({ id: 'custom', installed: true }),
      listModels: async () => ({ source: 'unavailable', models: [], efforts: [] }),
      run: async () => okResult([job(1)]),
    };
    const verify = (async () => ({
      status: 'redirected',
      finalUrl: 'https://careers.example.com/role-1',
      httpStatus: 200,
    })) as typeof verifyLink;
    const h = createDiscoveryHandler({ profilesRepo, jobsRepo, settingsRepo, adapterFactory: () => adapter, verify });
    await h(ctx());
    const [row] = jobsRepo.list(profileId);
    expect(row?.canonical_url).toBe('https://careers.example.com/role-1');
    expect(row?.dedupe_key).toBe('https://careers.example.com/role-1');
  });

  it('skips unparseable urls and counts them as dead', async () => {
    saveProfile();
    const res = await makeHandler(okResult([job(1, { url: 'not a url' }), job(2)]))(ctx());
    expect(res.summary).toBe('1 new, 0 duplicates, 1 dead, 0 unverified');
    expect(logs).toContain('Skipping unparseable url: not a url');
  });

  it('skips non-http urls without verifying them and counts them as dead', async () => {
    saveProfile();
    const verified: string[] = [];
    const adapter: AgentAdapter = {
      id: 'custom',
      check: async () => ({ id: 'custom', installed: true }),
      listModels: async () => ({ source: 'unavailable', models: [], efforts: [] }),
      run: async () => okResult([job(1, { url: 'javascript:alert(1)' }), job(2)]),
    };
    const verify = (async (url: string) => {
      verified.push(url);
      return { status: 'ok', finalUrl: url, httpStatus: 200 };
    }) as typeof verifyLink;
    const h = createDiscoveryHandler({ profilesRepo, jobsRepo, settingsRepo, adapterFactory: () => adapter, verify });
    const res = await h(ctx());
    expect(res.summary).toBe('1 new, 0 duplicates, 1 dead, 0 unverified');
    expect(logs).toContain('Skipping unsupported url: javascript:alert(1)');
    expect(verified).toEqual(['https://jobs.example.com/2']);
    expect(jobsRepo.list(profileId, { includeDead: true }).map((j) => j.url)).toEqual(['https://jobs.example.com/2']);
  });

  it('throws when output does not match the schema', async () => {
    saveProfile();
    await expect(makeHandler(okResult([{ title: 'x' }]))(ctx())).rejects.toThrow(
      /Agent output did not match schema: jobs\.0\.company/,
    );
  });

  it('throws when the agent run fails', async () => {
    saveProfile();
    const failed: AgentResult = { ok: false, error: 'boom', rawStdout: '', rawStderr: '', exitCode: 1, durationMs: 1 };
    await expect(makeHandler(failed)(ctx())).rejects.toThrow('Agent run failed: boom');
  });

  it("throws when the run's profile is gone, before calling the adapter", async () => {
    saveProfile();
    const c = ctx();
    await expect(makeHandler(okResult([]))({ ...c, run: { ...c.run, profile_id: 'missing' } })).rejects.toThrow(
      'Profile not found',
    );
    expect(adapterCalls).toBe(0);
  });

  it("hands the agent the run's own profile and only that profile's known urls, and stores jobs there", async () => {
    const first = saveProfile();
    await makeHandler(okResult([job(1)]))(ctx());
    const second = saveProfile({ ...PROFILE, name: 'Data roles', target_roles: ['Data Engineer'] });
    const prompts: string[] = [];
    const handler = makeHandler(okResult([job(1), job(2)]), {}, {
      run: async (task) => {
        prompts.push(task.prompt);
        return okResult([job(1), job(2)]);
      },
    });
    const res = await handler(ctx());
    expect(res.summary).toBe('2 new, 0 duplicates, 0 dead, 0 unverified');
    expect(prompts[0]).toContain('Target roles: Data Engineer');
    expect(prompts[0]).not.toContain('Backend Engineer');
    expect(prompts[0]).not.toContain('https://jobs.example.com/1');
    expect(prompts[0]).not.toContain('Data roles');
    expect(jobsRepo.list(first)).toHaveLength(1);
    expect(jobsRepo.list(second)).toHaveLength(2);
  });

  it('stops before checking links or saving when beginSaving refuses', async () => {
    saveProfile();
    let verified = 0;
    const handler = createDiscoveryHandler({
      profilesRepo,
      jobsRepo,
      settingsRepo,
      adapterFactory: () => ({
        id: 'custom',
        check: async () => ({ id: 'custom', installed: true }),
        listModels: async () => ({ source: 'unavailable', models: [], efforts: [] }),
        run: async () => okResult([job(1)]),
      }),
      verify: (async (url: string) => {
        verified++;
        return { status: 'ok', finalUrl: url, httpStatus: 200 };
      }) as typeof verifyLink,
    });
    const c = {
      ...ctx(),
      beginSaving: () => {
        throw new Error('Aborted');
      },
    };
    await expect(handler(c)).rejects.toThrow('Aborted');
    expect(verified).toBe(0);
    expect(jobsRepo.list(profileId)).toHaveLength(0);
  });

  it('enters the saving phase after the agent returns and before checking links', async () => {
    saveProfile();
    const events: string[] = [];
    const handler = createDiscoveryHandler({
      profilesRepo,
      jobsRepo,
      settingsRepo,
      adapterFactory: () => ({
        id: 'custom',
        check: async () => ({ id: 'custom', installed: true }),
        listModels: async () => ({ source: 'unavailable', models: [], efforts: [] }),
        run: async () => {
          events.push('agent');
          return okResult([job(1)]);
        },
      }),
      verify: (async (url: string) => {
        events.push('verify');
        return { status: 'ok', finalUrl: url, httpStatus: 200 };
      }) as typeof verifyLink,
    });
    await handler({ ...ctx(), beginSaving: () => void events.push('saving') });
    expect(events).toEqual(['agent', 'saving', 'verify']);
  });

  it('does not enter the saving phase when the agent run fails', async () => {
    saveProfile();
    let saving = 0;
    const failed: AgentResult = { ...okResult([]), ok: false, error: 'Exited with code 1' };
    await expect(makeHandler(failed)({ ...ctx(), beginSaving: () => void saving++ })).rejects.toThrow(
      'Agent run failed',
    );
    expect(saving).toBe(0);
  });
});
