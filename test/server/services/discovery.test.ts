import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentResult, AgentTask, RunOptions } from '../../../src/server/agents/types.js';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createJobsRepo } from '../../../src/server/db/jobs-repo.js';
import { createProfilesRepo, type ProfileInput } from '../../../src/server/db/profiles-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { createSettingsRepo } from '../../../src/server/db/settings-repo.js';
import type { EffortMode, VerificationStatus } from '../../../src/server/domain/types.js';
import type { RunContext } from '../../../src/server/runs/queue.js';
import { createDiscoveryHandler, DEFAULT_SCOPE, MAX_WORKERS } from '../../../src/server/services/discovery.js';
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
  mail_filter_kind: 'label',
  mail_filter: '',
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

// Verdicts as [status, httpStatus, finalUrl?] per url; urls not listed answer 200 ok.
function verdictHandler(
  result: AgentResult,
  verdicts: Record<string, [VerificationStatus, number | null, string?]>,
) {
  const adapter: AgentAdapter = {
    id: 'custom',
    check: async () => ({ id: 'custom', installed: true }),
    listModels: async () => ({ source: 'unavailable', models: [], efforts: [] }),
    run: async () => result,
  };
  const verify = (async (url: string) => {
    const [status, httpStatus, finalUrl] = verdicts[url] ?? ['ok', 200];
    return { status, finalUrl: finalUrl ?? url, httpStatus };
  }) as typeof verifyLink;
  return createDiscoveryHandler({ profilesRepo, jobsRepo, settingsRepo, adapterFactory: () => adapter, verify });
}

function okResult(jobs: unknown[]): AgentResult {
  return { ok: true, output: { jobs }, rawStdout: '', rawStderr: '', exitCode: 0, durationMs: 1 };
}

function ctx(effortMode: EffortMode = 'default'): RunContext {
  const run = runsRepo.create('discover_jobs', profileId, {
    adapter_id: 'custom',
    prompt_version: null,
    effort_mode: effortMode,
  });
  return {
    run,
    log: (l) => logs.push(l),
    signal: new AbortController().signal,
    runDir: mkdtempSync(join(tmpdir(), 'discovery-')),
    recordAgent: (record) => runsRepo.update(run.id, record),
    recordUsage: (record) => runsRepo.update(run.id, record),
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

  it('records a found-again job as last seen by the later search and keeps its first search', async () => {
    saveProfile();
    const first = ctx();
    await makeHandler(okResult([job(1)]))(first);
    const before = jobsRepo.list(profileId)[0]!;
    expect(before).toMatchObject({ run_id: first.run.id, last_seen_run_id: first.run.id });
    expect(before.last_seen_at).toBe(before.created_at);

    const second = ctx();
    const res = await makeHandler(okResult([job(1), job(2)]))(second);

    expect(res.summary).toBe('1 new, 1 duplicates, 0 dead, 0 unverified');
    const seen = jobsRepo.get(before.id)!;
    expect(seen).toMatchObject({ run_id: first.run.id, created_at: before.created_at, last_seen_run_id: second.run.id });
    expect(seen.last_seen_at >= before.last_seen_at).toBe(true);
    const fresh = jobsRepo.list(profileId).find((j) => j.url.endsWith('/2'))!;
    expect(fresh).toMatchObject({ run_id: second.run.id, last_seen_run_id: second.run.id });
  });

  it("takes a found-again job's fresh link status when the site answered", async () => {
    saveProfile();
    await makeHandler(okResult([job(1)]))(ctx());
    // An old check time, so the new one differs even within one millisecond.
    db.prepare("UPDATE jobs SET verified_at = '2026-01-01T00:00:00.000Z'").run();
    const before = jobsRepo.list(profileId)[0]!;

    await verdictHandler(okResult([job(1)]), { 'https://jobs.example.com/1': ['dead', 404] })(ctx());

    const after = jobsRepo.get(before.id)!;
    expect(after.verification_status).toBe('dead');
    expect(after.verified_at! > '2026-01-01T00:00:00.000Z').toBe(true);
  });

  it("keeps a found-again job's link status when the check was inconclusive", async () => {
    saveProfile();
    await makeHandler(okResult([job(1), job(2)]))(ctx());
    const [one, two] = ['/1', '/2'].map((s) => jobsRepo.list(profileId).find((j) => j.url.endsWith(s))!);

    // A network error reports dead without an answer (ENOTFOUND); a 503 is unverified.
    const third = ctx();
    await verdictHandler(okResult([job(1), job(2)]), {
      'https://jobs.example.com/1': ['dead', null],
      'https://jobs.example.com/2': ['unverified', 503],
    })(third);

    for (const before of [one!, two!]) {
      const after = jobsRepo.get(before.id)!;
      expect(after).toMatchObject({
        verification_status: 'ok',
        verified_at: before.verified_at,
        last_seen_run_id: third.run.id,
      });
    }
  });

  it('uses the first conclusive check when two links of one search lead to the same known job', async () => {
    saveProfile();
    await makeHandler(okResult([job(1)]))(ctx());
    const before = jobsRepo.list(profileId)[0]!;

    // The known link times out; an alias link redirects to it and answers.
    const res = await verdictHandler(okResult([job(1), job(7)]), {
      'https://jobs.example.com/1': ['unverified', null],
      'https://jobs.example.com/7': ['redirected', 200, 'https://jobs.example.com/1'],
    })(ctx());

    expect(res.summary).toBe('0 new, 2 duplicates, 0 dead, 0 unverified');
    expect(jobsRepo.get(before.id)!.verification_status).toBe('redirected');
  });

  it('matches a known job whose link now redirects elsewhere instead of saving the new page', async () => {
    saveProfile();
    await makeHandler(okResult([job(1)]))(ctx());
    const before = jobsRepo.list(profileId)[0]!;

    // A closed posting that now sends visitors to the company's job board.
    const second = ctx();
    const res = await verdictHandler(okResult([job(1)]), {
      'https://jobs.example.com/1': ['redirected', 200, 'https://jobs.example.com/board'],
    })(second);

    expect(res.summary).toBe('0 new, 1 duplicates, 0 dead, 0 unverified');
    expect(jobsRepo.list(profileId)).toHaveLength(1);
    expect(jobsRepo.get(before.id)).toMatchObject({
      verification_status: 'redirected',
      last_seen_run_id: second.run.id,
      canonical_url: 'https://jobs.example.com/1',
    });
  });

  it('prefers the returned link over the page it redirects to when both are known jobs', async () => {
    saveProfile();
    // An earlier search saved the board page as a job of its own.
    await makeHandler(okResult([job(1), job(9, { url: 'https://jobs.example.com/board' })]))(ctx());
    const [original, board] = ['/1', '/board'].map((s) => jobsRepo.list(profileId).find((j) => j.url.endsWith(s))!);

    const third = ctx();
    await verdictHandler(okResult([job(1)]), {
      'https://jobs.example.com/1': ['redirected', 200, 'https://jobs.example.com/board'],
    })(third);

    expect(jobsRepo.get(original!.id)).toMatchObject({ verification_status: 'redirected', last_seen_run_id: third.run.id });
    expect(jobsRepo.get(board!.id)).toMatchObject({ verification_status: 'ok', last_seen_run_id: board!.run_id });
  });

  it('updates a dismissed job that is found again and keeps it dismissed', async () => {
    saveProfile();
    await makeHandler(okResult([job(1)]))(ctx());
    const before = jobsRepo.list(profileId)[0]!;
    jobsRepo.dismiss(before.id);

    const second = ctx();
    await makeHandler(okResult([job(1)]))(second);

    const after = jobsRepo.get(before.id)!;
    expect(after.dismissed_at).not.toBeNull();
    expect(after.last_seen_run_id).toBe(second.run.id);
  });

  it('checks each distinct link once, also when workers return it several times', async () => {
    saveProfile();
    const checked: string[] = [];
    const adapter: AgentAdapter = {
      id: 'custom',
      check: async () => ({ id: 'custom', installed: true }),
      listModels: async () => ({ source: 'unavailable', models: [], efforts: [] }),
      run: async () => okResult([job(1), job(1, { title: 'Engineer 1 (EU)' }), job(2), job(1)]),
    };
    const verify = (async (url: string) => {
      checked.push(url);
      return { status: 'ok', finalUrl: url, httpStatus: 200 };
    }) as typeof verifyLink;
    const h = createDiscoveryHandler({ profilesRepo, jobsRepo, settingsRepo, adapterFactory: () => adapter, verify });
    const res = await h(ctx());
    expect(checked.sort()).toEqual(['https://jobs.example.com/1', 'https://jobs.example.com/2']);
    expect(res.summary).toBe('2 new, 2 duplicates, 0 dead, 0 unverified');
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

// Scope text identifies the worker in fake adapters below.
function workerOf(prompt: string): number {
  const i = MAX_WORKERS.findIndex((w) => prompt.includes(w.scope));
  if (i === -1) throw new Error('prompt carries no worker scope');
  return i + 1;
}

function scriptedAdapter(byWorker: (n: number, task: AgentTask, opts: RunOptions) => Promise<AgentResult>): AgentAdapter {
  return {
    id: 'custom',
    check: async () => ({ id: 'custom', installed: true }),
    listModels: async () => ({ source: 'unavailable', models: [], efforts: [] }),
    run: (task, opts) => byWorker(workerOf(task.prompt), task, opts),
  };
}

function handlerFor(adapter: AgentAdapter) {
  const verify = (async (url: string) => ({ status: 'ok', finalUrl: url, httpStatus: 200 })) as typeof verifyLink;
  return createDiscoveryHandler({ profilesRepo, jobsRepo, settingsRepo, adapterFactory: () => adapter, verify });
}

describe('discovery effort levels', () => {
  it('a default run is one agent call with the full scope in the run directory', async () => {
    saveProfile();
    const calls: { prompt: string; cwd: string }[] = [];
    const c = ctx();
    await makeHandler(okResult([job(1)]), {}, {
      run: async (task, opts) => {
        calls.push({ prompt: task.prompt, cwd: opts.cwd });
        return okResult([job(1)]);
      },
    })(c);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain(DEFAULT_SCOPE);
    expect(calls[0]!.cwd).toBe(c.runDir);
    expect(logs.some((l) => l.startsWith('[worker'))).toBe(false);
  });

  it('a max run sends five scoped workers, at most three at a time, each in its own directory', async () => {
    saveProfile();
    let running = 0;
    let peak = 0;
    const seen: { n: number; cwd: string }[] = [];
    const c = ctx('max');
    const adapter = scriptedAdapter(async (n, _task, opts) => {
      running++;
      peak = Math.max(peak, running);
      seen.push({ n, cwd: opts.cwd });
      opts.onLog?.(`line from ${n}`);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return okResult([job(n)]);
    });
    const res = await handlerFor(adapter)(c);
    expect(seen.map((s) => s.n).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(3);
    for (const { n, cwd } of seen) expect(cwd).toBe(join(c.runDir, `worker-${n}`));
    expect(logs).toContain('[worker 2] line from 2');
    expect(logs).toContain(`Max effort: ${MAX_WORKERS.length} workers, up to 3 at a time`);
    expect(logs).toContain(`Worker 1 (${MAX_WORKERS[0]!.name}) started`);
    expect(res.summary).toBe('5 new, 0 duplicates, 0 dead, 0 unverified');
  });

  it('a max run merges workers and drops the same job found twice', async () => {
    saveProfile();
    const adapter = scriptedAdapter(async (n) => okResult(n <= 2 ? [job(1), job(n + 10)] : []));
    const res = await handlerFor(adapter)(ctx('max'));
    expect(res.summary).toBe('3 new, 1 duplicates, 0 dead, 0 unverified');
    expect(jobsRepo.list(profileId).map((j) => j.url).sort()).toEqual([
      'https://jobs.example.com/1',
      'https://jobs.example.com/11',
      'https://jobs.example.com/12',
    ]);
  });

  it('a max run keeps the jobs of workers that succeeded and names the ones that failed', async () => {
    saveProfile();
    const adapter = scriptedAdapter(async (n) => {
      if (n === 2) return { ...okResult([]), ok: false, error: 'Timed out after 1000 ms' };
      if (n === 4) return okResult([{ title: 'no company' }]);
      return okResult([job(n)]);
    });
    const res = await handlerFor(adapter)(ctx('max'));
    expect(res.summary).toBe('3 new, 0 duplicates, 0 dead, 0 unverified; 2 of 5 workers failed');
    expect(logs).toContain(`Worker 2 (${MAX_WORKERS[1]!.name}) failed: Agent run failed: Timed out after 1000 ms`);
    expect(logs.some((l) => l.startsWith(`Worker 4 (${MAX_WORKERS[3]!.name}) failed: Agent output did not match schema`))).toBe(true);
    expect(jobsRepo.list(profileId)).toHaveLength(3);
  });

  it('a max run fails with the first worker error when every worker fails, and saves nothing', async () => {
    saveProfile();
    let saving = 0;
    const adapter = scriptedAdapter(async (n) => ({ ...okResult([]), ok: false, error: `boom ${n}` }));
    await expect(handlerFor(adapter)({ ...ctx('max'), beginSaving: () => void saving++ })).rejects.toThrow(
      'Agent run failed: boom 1',
    );
    expect(saving).toBe(0);
  });

  it('records usage summed over max workers, also when some fail', async () => {
    saveProfile();
    const c = ctx('max');
    const adapter = scriptedAdapter(async (n) =>
      n === 5
        ? { ...okResult([]), ok: false, error: 'Exited with code 1', usage: { costUsd: 0.5, inputTokens: 100 } }
        : { ...okResult([job(n)]), usage: { costUsd: 0.25, inputTokens: 1000, outputTokens: 10 } },
    );
    await handlerFor(adapter)(c);
    expect(runsRepo.get(c.run.id)).toMatchObject({
      usage_cost_usd: 1.5,
      usage_input_tokens: 4100,
      usage_output_tokens: 40,
    });
  });

  it('records usage of a default run that failed', async () => {
    saveProfile();
    const c = ctx();
    const failed: AgentResult = { ...okResult([]), ok: false, error: 'Exited with code 1', usage: { outputTokens: 7 } };
    await expect(makeHandler(failed)(c)).rejects.toThrow('Agent run failed');
    expect(runsRepo.get(c.run.id)).toMatchObject({
      usage_cost_usd: null,
      usage_input_tokens: null,
      usage_output_tokens: 7,
    });
  });

  it('a worker that throws outside the agent counts as failed and the others finish first', async () => {
    saveProfile();
    const c = ctx('max');
    const finished: number[] = [];
    const adapter = scriptedAdapter(async (n) => {
      await new Promise((r) => setTimeout(r, 20));
      finished.push(n);
      return okResult([job(n)]);
    });
    const res = await handlerFor(adapter)({
      ...c,
      log: (l) => {
        if (l === `Worker 4 (${MAX_WORKERS[3]!.name}) started`) throw new Error('disk full');
        logs.push(l);
      },
    });
    expect(finished.sort()).toEqual([1, 2, 3, 5]);
    expect(res.summary).toBe('4 new, 0 duplicates, 0 dead, 0 unverified; 1 of 5 workers failed');
    expect(logs).toContain(`Worker 4 (${MAX_WORKERS[3]!.name}) failed: disk full`);
  });

  it('a cancel during a max run starts no further worker and saves nothing', async () => {
    saveProfile();
    const controller = new AbortController();
    const c = { ...ctx('max'), signal: controller.signal };
    const called: number[] = [];
    const adapter = scriptedAdapter((n, _task, opts) => {
      called.push(n);
      if (called.length === 3) controller.abort();
      // Like the real adapter: a running agent ends with 'Aborted' once the signal fires.
      return new Promise((resolve) => {
        const end = () => resolve({ ...okResult([]), ok: false, error: 'Aborted' });
        if (opts.signal?.aborted) end();
        else opts.signal?.addEventListener('abort', end, { once: true });
      });
    });
    await expect(handlerFor(adapter)(c)).rejects.toThrow('Agent run failed: Aborted');
    expect(called.sort()).toEqual([1, 2, 3]);
    expect(existsSync(join(c.runDir, 'worker-4'))).toBe(false);
    expect(logs.some((l) => l.startsWith('Worker 4 (') && l.endsWith('started'))).toBe(false);
    expect(jobsRepo.list(profileId)).toHaveLength(0);
  });

  it('a cancel after some workers found jobs still saves nothing', async () => {
    saveProfile();
    const controller = new AbortController();
    const c = {
      ...ctx('max'),
      signal: controller.signal,
      // As the queue does: saving is refused once the run was cancelled.
      beginSaving: () => {
        if (controller.signal.aborted) throw new Error('Aborted');
      },
    };
    const adapter = scriptedAdapter(async (n) => {
      if (n === 3) controller.abort();
      return n <= 2 ? okResult([job(n)]) : { ...okResult([]), ok: false, error: 'Aborted' };
    });
    await expect(handlerFor(adapter)(c)).rejects.toThrow('Aborted');
    expect(jobsRepo.list(profileId)).toHaveLength(0);
  });

  it('stores the fit checks the agent returned', async () => {
    saveProfile();
    const checks = { location: 'fail', remote: 'pass', seniority: 'unknown' };
    await makeHandler(okResult([job(1, { checks })]))(ctx());
    expect(jobsRepo.list(profileId)[0]!.fit_checks).toEqual(checks);
  });
});
