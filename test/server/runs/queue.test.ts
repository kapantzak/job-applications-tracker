import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import type { Run, RunKind, RunStatus } from '../../../src/server/domain/types.js';
import { createLogStore } from '../../../src/server/runs/log-store.js';
import { createRunQueue, type RunHandler } from '../../../src/server/runs/queue.js';

type Queue = ReturnType<typeof createRunQueue>;

let db: Db;
let runsDir: string;
let runsRepo: ReturnType<typeof createRunsRepo>;
let logStore: ReturnType<typeof createLogStore>;
let queue: Queue | null;

const TERMINAL: RunStatus[] = ['succeeded', 'failed', 'aborted'];

async function waitFor(check: () => boolean, timeoutMs = 2000, intervalMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function waitForTerminal(id: string): Promise<Run> {
  await waitFor(() => TERMINAL.includes(runsRepo.get(id)?.status as RunStatus));
  return runsRepo.get(id) as Run;
}

function makeQueue(
  handlers: Partial<Record<RunKind, RunHandler>>,
  extra: { stopTimeoutMs?: number } = {},
): Queue {
  const fallback: RunHandler = async () => ({ summary: 'noop' });
  queue = createRunQueue({
    runsRepo,
    logStore,
    runsDir,
    handlers: {
      discover_jobs: handlers.discover_jobs ?? fallback,
      sync_mail: handlers.sync_mail ?? fallback,
    },
    ...extra,
  });
  return queue;
}

function insertRaw(status: RunStatus, kind: RunKind = 'discover_jobs'): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO runs (id, kind, status, started_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, kind, status, status === 'running' ? now : null, now);
  return id;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  runsDir = mkdtempSync(join(tmpdir(), 'jobtrack-runs-'));
  runsRepo = createRunsRepo(db);
  logStore = createLogStore(runsDir);
  queue = null;
});

afterEach(async () => {
  await queue?.stop();
  rmSync(runsDir, { recursive: true, force: true });
  db.close();
});

describe('runs repo', () => {
  it('creates queued runs with null start time and updates only provided keys', () => {
    const run = runsRepo.create('sync_mail', { adapter_id: 'claude', prompt_version: null });
    expect(run).toMatchObject({
      kind: 'sync_mail',
      status: 'queued',
      started_at: null,
      finished_at: null,
      adapter_id: 'claude',
      prompt_version: null,
      summary: null,
      error: null,
    });
    const updated = runsRepo.update(run.id, { summary: 's' });
    expect(updated).toMatchObject({ status: 'queued', summary: 's', adapter_id: 'claude' });
    expect(() => runsRepo.update('missing', { summary: 'x' })).toThrow('Run not found: missing');
  });

  it('lists newest first, finds the oldest queued run and reports active kinds', () => {
    const a = runsRepo.create('discover_jobs', { adapter_id: '', prompt_version: null });
    const b = runsRepo.create('sync_mail', { adapter_id: '', prompt_version: null });
    expect(runsRepo.list().map((r) => r.id)).toEqual([b.id, a.id]);
    expect(runsRepo.list(1).map((r) => r.id)).toEqual([b.id]);
    expect(runsRepo.nextQueued()?.id).toBe(a.id);
    expect(runsRepo.hasActive('discover_jobs')).toBe(true);
    expect(runsRepo.findActive('sync_mail')?.id).toBe(b.id);
    runsRepo.update(a.id, { status: 'succeeded' });
    expect(runsRepo.hasActive('discover_jobs')).toBe(false);
    expect(runsRepo.findActive('discover_jobs')).toBeNull();
  });
});

describe('run queue', () => {
  it('runs a queued run to succeeded, stores the summary and writes logged lines', async () => {
    let seenDir = '';
    const q = makeQueue({
      discover_jobs: async ({ log, runDir }) => {
        seenDir = runDir;
        log('hello from handler');
        return { summary: 'done', promptVersion: 'v2' };
      },
    });
    const run = q.enqueue('discover_jobs');
    q.start();
    const done = await waitForTerminal(run.id);
    expect(done.status).toBe('succeeded');
    expect(done.summary).toBe('done');
    expect(done.prompt_version).toBe('v2');
    expect(done.started_at).not.toBeNull();
    expect(done.finished_at).not.toBeNull();
    expect(seenDir).toBe(join(runsDir, run.id));
    expect(statSync(seenDir).isDirectory()).toBe(true);
    const text = logStore.read(run.id);
    expect(text).toContain('hello from handler\n');
    expect(text).toContain(`Run ${run.id} (discover_jobs) started`);
    expect(text).toContain(`Run ${run.id} succeeded: done`);
  });

  it('marks a run failed with the error message when the handler throws', async () => {
    const q = makeQueue({
      discover_jobs: async () => {
        throw new Error('boom');
      },
    });
    q.start();
    const run = q.enqueue('discover_jobs');
    const done = await waitForTerminal(run.id);
    expect(done.status).toBe('failed');
    expect(done.error).toBe('boom');
    expect(logStore.read(run.id)).toContain(`Run ${run.id} failed: boom`);
  });

  it('keeps draining after a handler that throws synchronously', async () => {
    const q = makeQueue({
      discover_jobs: (() => {
        throw new Error('sync boom');
      }) as RunHandler,
      sync_mail: async () => ({ summary: 'mail ok' }),
    });
    const first = q.enqueue('discover_jobs');
    const second = q.enqueue('sync_mail');
    q.start();
    expect((await waitForTerminal(first.id)).error).toBe('sync boom');
    expect((await waitForTerminal(second.id)).status).toBe('succeeded');
  });

  it('returns the existing run when the kind already has a queued run', () => {
    const q = makeQueue({});
    const first = q.enqueue('discover_jobs');
    const second = q.enqueue('discover_jobs');
    expect(second.id).toBe(first.id);
    expect(runsRepo.list()).toHaveLength(1);
  });

  it('aborts runs left running by a previous process and still executes queued ones', async () => {
    const stale = insertRaw('running');
    const pending = insertRaw('queued', 'sync_mail');
    const q = makeQueue({ sync_mail: async () => ({ summary: 'synced' }) });
    q.start();
    const aborted = runsRepo.get(stale) as Run;
    expect(aborted.status).toBe('aborted');
    expect(aborted.error).toBe('server restarted');
    expect(aborted.finished_at).not.toBeNull();
    const done = await waitForTerminal(pending);
    expect(done.status).toBe('succeeded');
    expect(done.summary).toBe('synced');
  });

  it('runs one handler at a time', async () => {
    let active = 0;
    let maxActive = 0;
    const handler: RunHandler = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { summary: 'ok' };
    };
    const q = makeQueue({ discover_jobs: handler, sync_mail: handler });
    q.start();
    const a = q.enqueue('discover_jobs');
    const b = q.enqueue('sync_mail');
    await waitForTerminal(a.id);
    await waitForTerminal(b.id);
    expect(maxActive).toBe(1);
  });

  it('stop() aborts the in-flight handler and resolves', async () => {
    let entered = false;
    const q = makeQueue({
      discover_jobs: ({ signal }) => {
        entered = true;
        return new Promise((_, rej) => {
          signal.addEventListener('abort', () => rej(new Error('aborted')));
        });
      },
    });
    q.start();
    const run = q.enqueue('discover_jobs');
    await waitFor(() => entered);
    expect(q.isRunning()).toBe(true);
    await q.stop();
    const done = runsRepo.get(run.id) as Run;
    expect(done.status).toBe('aborted');
    expect(done.error).toBe('Aborted');
    expect(q.isRunning()).toBe(false);
    // After stop, enqueue still records the run but nothing executes it.
    const later = q.enqueue('sync_mail');
    await new Promise((r) => setTimeout(r, 20));
    expect(runsRepo.get(later.id)?.status).toBe('queued');
  });

  it('stop() gives up on a handler that ignores the signal and keeps the run aborted', async () => {
    let release: (v: { summary: string }) => void = () => {};
    let entered = false;
    const q = makeQueue(
      {
        discover_jobs: () => {
          entered = true;
          return new Promise((res) => {
            release = res;
          });
        },
      },
      { stopTimeoutMs: 20 },
    );
    q.start();
    const run = q.enqueue('discover_jobs');
    await waitFor(() => entered);
    await q.stop();
    expect(runsRepo.get(run.id)?.status).toBe('aborted');
    release({ summary: 'too late' });
    await waitFor(() => !q.isRunning());
    const final = runsRepo.get(run.id) as Run;
    expect(final.status).toBe('aborted');
    expect(final.summary).toBeNull();
  });
});

describe('log store', () => {
  it('delivers lines appended after subscribing until unsubscribed', () => {
    const id = randomUUID();
    logStore.append(id, 'before');
    const seen: string[] = [];
    const unsubscribe = logStore.subscribe(id, (line) => seen.push(line));
    logStore.append(id, 'one');
    logStore.append(randomUUID(), 'other run');
    unsubscribe();
    logStore.append(id, 'two');
    expect(seen).toEqual(['one']);
    expect(logStore.read(id)).toBe('before\none\ntwo\n');
    expect(logStore.read(randomUUID())).toBe('');
  });

  it('purge deletes log files except kept runs and leaves run directories', () => {
    const keep = randomUUID();
    const drop = randomUUID();
    logStore.append(keep, 'k');
    logStore.append(drop, 'd');
    writeFileSync(join(runsDir, 'notes.txt'), 'x');
    mkdirSync(join(runsDir, drop));
    writeFileSync(join(runsDir, drop, 'raw.txt'), 'r');
    expect(logStore.purge(new Set([keep]))).toBe(1);
    expect(readdirSync(runsDir).sort()).toEqual([`${keep}.log`, drop, 'notes.txt'].sort());
    expect(existsSync(join(runsDir, drop, 'raw.txt'))).toBe(true);
    expect(logStore.read(drop)).toBe('');
  });
});
