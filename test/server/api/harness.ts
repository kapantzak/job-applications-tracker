import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createApp, type AppDeps } from '../../../src/server/app.js';
import type { AdapterHealth, AgentAdapter } from '../../../src/server/agents/index.js';
import { createApplicationsRepo } from '../../../src/server/db/applications-repo.js';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { createJobsRepo, type NewJob } from '../../../src/server/db/jobs-repo.js';
import { createProfileRepo, type ProfileInput } from '../../../src/server/db/profile-repo.js';
import { createProposalsRepo } from '../../../src/server/db/proposals-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { createSettingsRepo } from '../../../src/server/db/settings-repo.js';
import type { Job, RunKind, Settings } from '../../../src/server/domain/types.js';
import { createLogStore } from '../../../src/server/runs/log-store.js';
import { createRunQueue, type RunHandler } from '../../../src/server/runs/queue.js';
import { createSyncScheduler } from '../../../src/server/runs/scheduler.js';
import { createProposalService } from '../../../src/server/services/proposals.js';

export interface Harness {
  app: Hono;
  deps: AppDeps;
  // Swap per test to control how runs behave.
  handlers: Record<RunKind, RunHandler>;
  factoryCalls: { settings: Settings; kind: RunKind }[];
  healthFor: Record<string, AdapterHealth | Error>;
  cleanup(): Promise<void>;
}

export const SAMPLE_PROFILE: ProfileInput = {
  target_roles: ['Platform Engineer'],
  locations: ['Lisbon'],
  remote: 'remote',
  seniority: 'senior',
  keywords: ['typescript'],
  excluded_companies: ['Initech'],
  notes: 'invented profile',
};

export function makeHarness(opts: { uiDir?: string | null } = {}): Harness {
  const db = openDatabase(':memory:');
  migrate(db);
  const runsDir = mkdtempSync(join(tmpdir(), 'jobtrack-api-runs-'));
  const profileRepo = createProfileRepo(db);
  const settingsRepo = createSettingsRepo(db);
  const jobsRepo = createJobsRepo(db);
  const applicationsRepo = createApplicationsRepo(db);
  const proposalsRepo = createProposalsRepo(db);
  const runsRepo = createRunsRepo(db);
  const proposalService = createProposalService({ db, proposalsRepo, applicationsRepo });
  const logStore = createLogStore(runsDir);
  const handlers: Record<RunKind, RunHandler> = {
    discover_jobs: async () => ({ summary: 'ok' }),
    sync_mail: async () => ({ summary: 'ok' }),
  };
  const queue = createRunQueue({
    runsRepo,
    logStore,
    runsDir,
    // Indirection so tests can replace handlers after the queue exists.
    handlers: {
      discover_jobs: (ctx) => handlers.discover_jobs(ctx),
      sync_mail: (ctx) => handlers.sync_mail(ctx),
    },
    stopTimeoutMs: 50,
  });
  const scheduler = createSyncScheduler({ settingsRepo, queue });
  const factoryCalls: Harness['factoryCalls'] = [];
  const healthFor: Harness['healthFor'] = {};
  const adapterFactory = (settings: Settings, kind: RunKind): AgentAdapter => {
    factoryCalls.push({ settings, kind });
    const id = settings.adapter_id;
    return {
      id,
      async check() {
        const health = healthFor[id] ?? { id, installed: true, version: '0.0.1-test' };
        if (health instanceof Error) throw health;
        return health;
      },
      async run() {
        throw new Error('stub adapter does not run');
      },
    };
  };
  const deps: AppDeps = {
    db,
    dataDir: '/invented/data-dir',
    runsDir,
    profileRepo,
    settingsRepo,
    jobsRepo,
    applicationsRepo,
    proposalsRepo,
    runsRepo,
    proposalService,
    queue,
    logStore,
    scheduler,
    adapterFactory,
    uiDir: opts.uiDir ?? null,
    ssePollMs: 20,
  };
  const app = createApp(deps);
  return {
    app,
    deps,
    handlers,
    factoryCalls,
    healthFor,
    async cleanup() {
      scheduler.stop();
      await queue.stop();
      rmSync(runsDir, { recursive: true, force: true });
      db.close();
    },
  };
}

export function sampleJob(overrides: Partial<NewJob> = {}): NewJob {
  return {
    company: 'Globex',
    title: 'Backend Engineer',
    location: 'Remote',
    remote: 'remote',
    url: 'https://careers.globex.example/jobs/42?ref=board',
    canonical_url: 'https://careers.globex.example/jobs/42',
    source_site: 'example-board',
    posted_at: null,
    salary: null,
    description_excerpt: 'Invented posting',
    match_reason: 'matches typescript',
    verification_status: 'ok',
    verified_at: null,
    dedupe_key: `globex|backend engineer|${Math.random()}`,
    ...overrides,
  };
}

export function insertJob(h: Harness, overrides: Partial<NewJob> = {}): Job {
  const run = h.deps.runsRepo.create('discover_jobs', { adapter_id: 'claude', prompt_version: null });
  const [job] = h.deps.jobsRepo.insertMany(run.id, [sampleJob(overrides)]);
  return job;
}

export function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

export async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
