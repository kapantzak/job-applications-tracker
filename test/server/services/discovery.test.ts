import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentResult } from '../../../src/server/agents/types.js';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createJobsRepo } from '../../../src/server/db/jobs-repo.js';
import { createProfileRepo } from '../../../src/server/db/profile-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { createSettingsRepo } from '../../../src/server/db/settings-repo.js';
import type { VerificationStatus } from '../../../src/server/domain/types.js';
import type { RunContext } from '../../../src/server/runs/queue.js';
import { createDiscoveryHandler } from '../../../src/server/services/discovery.js';
import type { verifyLink } from '../../../src/server/verify/links.js';

let db: Db;
let profileRepo: ReturnType<typeof createProfileRepo>;
let jobsRepo: ReturnType<typeof createJobsRepo>;
let settingsRepo: ReturnType<typeof createSettingsRepo>;
let runsRepo: ReturnType<typeof createRunsRepo>;
let logs: string[];
let adapterCalls: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  profileRepo = createProfileRepo(db);
  jobsRepo = createJobsRepo(db);
  settingsRepo = createSettingsRepo(db);
  runsRepo = createRunsRepo(db);
  logs = [];
  adapterCalls = 0;
});

function saveProfile(): void {
  profileRepo.save({
    target_roles: ['Backend Engineer'],
    locations: ['Berlin'],
    remote: 'hybrid',
    seniority: 'senior',
    keywords: [],
    excluded_companies: [],
    notes: '',
  });
}

function job(n: number, extra: Record<string, unknown> = {}) {
  return { company: `Acme ${n}`, title: `Engineer ${n}`, url: `https://jobs.example.com/${n}`, ...extra };
}

function makeHandler(result: AgentResult, statuses: Record<string, VerificationStatus> = {}) {
  const adapter: AgentAdapter = {
    id: 'custom',
    check: async () => ({ id: 'custom', installed: true }),
    run: async () => {
      adapterCalls++;
      return result;
    },
  };
  const verify = (async (url: string) => ({
    status: statuses[url] ?? 'ok',
    finalUrl: url,
    httpStatus: 200,
  })) as typeof verifyLink;
  return createDiscoveryHandler({ profileRepo, jobsRepo, settingsRepo, adapterFactory: () => adapter, verify });
}

function okResult(jobs: unknown[]): AgentResult {
  return { ok: true, output: { jobs }, rawStdout: '', rawStderr: '', exitCode: 0, durationMs: 1 };
}

function ctx(): RunContext {
  const run = runsRepo.create('discover_jobs', { adapter_id: 'custom', prompt_version: null });
  return {
    run,
    log: (l) => logs.push(l),
    signal: new AbortController().signal,
    runDir: mkdtempSync(join(tmpdir(), 'discovery-')),
  };
}

describe('discovery handler', () => {
  it('stores verified jobs', async () => {
    saveProfile();
    const res = await makeHandler(okResult([job(1), job(2)]))(ctx());
    expect(res.summary).toBe('2 new, 0 duplicates, 0 dead, 0 unverified');
    expect(res.promptVersion).toBeTruthy();
    expect(res.adapterId).toBe('custom');
    expect(jobsRepo.list()).toHaveLength(2);
    expect(logs).toContain('Using adapter custom');
    expect(logs).toContain(res.summary);
  });

  it('skips jobs whose key already exists and duplicates in the batch', async () => {
    saveProfile();
    const c = ctx();
    await makeHandler(okResult([job(1)]))(c);
    const res = await makeHandler(okResult([job(1), job(2), job(2)]))(ctx());
    expect(res.summary).toBe('1 new, 2 duplicates, 0 dead, 0 unverified');
    expect(jobsRepo.list()).toHaveLength(2);
  });

  it('stores dead jobs and counts them', async () => {
    saveProfile();
    const res = await makeHandler(okResult([job(1), job(2)]), {
      'https://jobs.example.com/1': 'dead',
      'https://jobs.example.com/2': 'unverified',
    })(ctx());
    expect(res.summary).toBe('2 new, 0 duplicates, 1 dead, 1 unverified');
    const dead = jobsRepo.list({ includeDead: true }).find((j) => j.url.endsWith('/1'));
    expect(dead?.verification_status).toBe('dead');
  });

  it('uses the final url for redirected jobs', async () => {
    saveProfile();
    const adapter: AgentAdapter = {
      id: 'custom',
      check: async () => ({ id: 'custom', installed: true }),
      run: async () => okResult([job(1)]),
    };
    const verify = (async () => ({
      status: 'redirected',
      finalUrl: 'https://careers.example.com/role-1',
      httpStatus: 200,
    })) as typeof verifyLink;
    const h = createDiscoveryHandler({ profileRepo, jobsRepo, settingsRepo, adapterFactory: () => adapter, verify });
    await h(ctx());
    const [row] = jobsRepo.list();
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
      run: async () => okResult([job(1, { url: 'javascript:alert(1)' }), job(2)]),
    };
    const verify = (async (url: string) => {
      verified.push(url);
      return { status: 'ok', finalUrl: url, httpStatus: 200 };
    }) as typeof verifyLink;
    const h = createDiscoveryHandler({ profileRepo, jobsRepo, settingsRepo, adapterFactory: () => adapter, verify });
    const res = await h(ctx());
    expect(res.summary).toBe('1 new, 0 duplicates, 1 dead, 0 unverified');
    expect(logs).toContain('Skipping unsupported url: javascript:alert(1)');
    expect(verified).toEqual(['https://jobs.example.com/2']);
    expect(jobsRepo.list({ includeDead: true }).map((j) => j.url)).toEqual(['https://jobs.example.com/2']);
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

  it('throws without a profile before calling the adapter', async () => {
    await expect(makeHandler(okResult([]))(ctx())).rejects.toThrow('Profile is not set');
    expect(adapterCalls).toBe(0);
  });

  it('throws Aborted when the signal is already aborted', async () => {
    saveProfile();
    const c = ctx();
    const controller = new AbortController();
    controller.abort();
    await expect(makeHandler(okResult([job(1)]))({ ...c, signal: controller.signal })).rejects.toThrow('Aborted');
    expect(jobsRepo.list()).toHaveLength(0);
  });
});
