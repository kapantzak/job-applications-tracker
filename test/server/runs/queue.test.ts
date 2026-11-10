import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { insertTestProfile } from '../db/test-profile.js';
import type { Run, RunKind, RunStatus } from '../../../src/server/domain/types.js';
import { createLogStore } from '../../../src/server/runs/log-store.js';
import { ActiveRunConflictError, createRunQueue, RUN_INPUT_FILE, type RunHandler } from '../../../src/server/runs/queue.js';

type Queue = ReturnType<typeof createRunQueue>;

let db: Db;
let runsDir: string;
let runsRepo: ReturnType<typeof createRunsRepo>;
let pid: string;
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

const noop: RunHandler = async () => ({ summary: 'noop' });

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
      import_jobs: handlers.import_jobs ?? fallback,
    },
    ...extra,
  });
  return queue;
}

function insertRaw(status: RunStatus, kind: RunKind = 'discover_jobs'): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO runs (id, profile_id, kind, status, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, pid, kind, status, status === 'running' ? now : null, now);
  return id;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  pid = insertTestProfile(db);
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
    const run = runsRepo.create('sync_mail', pid, { adapter_id: 'claude', prompt_version: null });
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
    const a = runsRepo.create('discover_jobs', pid, { adapter_id: '', prompt_version: null });
    const b = runsRepo.create('sync_mail', pid, { adapter_id: '', prompt_version: null });
    expect(runsRepo.list(pid).map((r) => r.id)).toEqual([b.id, a.id]);
    expect(runsRepo.list(pid, 1).map((r) => r.id)).toEqual([b.id]);
    expect(runsRepo.nextQueued()?.id).toBe(a.id);
    expect(runsRepo.hasActive('discover_jobs', pid)).toBe(true);
    expect(runsRepo.findActive('sync_mail', pid)?.id).toBe(b.id);
    expect(runsRepo.findActiveExcept('sync_mail', pid, b.id)).toBeNull();
    const c = runsRepo.create('discover_jobs', pid, { adapter_id: '', prompt_version: null });
    expect(runsRepo.findActiveExcept('discover_jobs', pid, a.id)?.id).toBe(c.id);
    runsRepo.update(c.id, { status: 'aborted' });
    runsRepo.update(a.id, { status: 'succeeded' });
    expect(runsRepo.hasActive('discover_jobs', pid)).toBe(false);
    expect(runsRepo.findActive('discover_jobs', pid)).toBeNull();
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
    const run = q.enqueue('discover_jobs', pid);
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

  it('records agent model and effort as soon as the handler reports them, also for a failed run', async () => {
    const q = makeQueue({
      discover_jobs: async ({ recordAgent }) => {
        recordAgent({ adapter_id: 'claude', agent_model: 'opus', agent_effort: '' });
        recordAgent({ agent_model_reported: 'model-a' });
        throw new Error('Agent run failed: Exited with code 1');
      },
    });
    const run = q.enqueue('discover_jobs', pid);
    q.start();
    const done = await waitForTerminal(run.id);
    expect(done.status).toBe('failed');
    expect(done).toMatchObject({
      adapter_id: 'claude',
      agent_model: 'opus',
      agent_effort: '',
      agent_model_reported: 'model-a',
    });
  });

  it('records usage as soon as the handler reports it, also for a failed run', async () => {
    const q = makeQueue({
      discover_jobs: async ({ recordUsage }) => {
        recordUsage({ usage_cost_usd: 0.75, usage_input_tokens: 2000, usage_output_tokens: 90 });
        throw new Error('Agent run failed: Exited with code 1');
      },
    });
    const run = q.enqueue('discover_jobs', pid);
    q.start();
    const done = await waitForTerminal(run.id);
    expect(done).toMatchObject({
      status: 'failed',
      usage_cost_usd: 0.75,
      usage_input_tokens: 2000,
      usage_output_tokens: 90,
    });
  });

  it('keeps the run going when recording usage fails', async () => {
    const realUpdate = runsRepo.update;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    runsRepo.update = ((id, patch) => {
      if ('usage_cost_usd' in patch) throw new Error('disk full');
      return realUpdate(id, patch);
    }) as typeof runsRepo.update;
    const q = makeQueue({
      discover_jobs: async ({ recordUsage }) => {
        recordUsage({ usage_cost_usd: 1 });
        return { summary: 'ok' };
      },
    });
    const run = q.enqueue('discover_jobs', pid);
    q.start();
    expect((await waitForTerminal(run.id)).status).toBe('succeeded');
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('failed to record usage: disk full'));
    runsRepo.update = realUpdate;
    consoleError.mockRestore();
  });

  it('keeps the run going when recording agent details fails', async () => {
    const realUpdate = runsRepo.update;
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args));
    runsRepo.update = (id, patch) => {
      if ('agent_model' in patch) throw new Error('disk full');
      return realUpdate(id, patch);
    };
    try {
      const q = makeQueue({
        discover_jobs: async ({ recordAgent }) => {
          recordAgent({ adapter_id: 'claude', agent_model: 'opus', agent_effort: '' });
          return { summary: 'done' };
        },
      });
      const run = q.enqueue('discover_jobs', pid);
      q.start();
      const done = await waitForTerminal(run.id);
      expect(done.status).toBe('succeeded');
      expect(done.agent_model).toBeNull();
      expect(String(errors[0])).toContain('failed to record agent details: disk full');
    } finally {
      runsRepo.update = realUpdate;
      consoleError.mockRestore();
    }
  });

  it('records the adapter id the handler reports', async () => {
    const q = makeQueue({ sync_mail: async () => ({ summary: 'ok', adapterId: 'custom' }) });
    const run = q.enqueue('sync_mail', pid);
    expect(run.adapter_id).toBe('');
    q.start();
    expect((await waitForTerminal(run.id)).adapter_id).toBe('custom');
  });

  it('marks a run failed with the error message when the handler throws', async () => {
    const q = makeQueue({
      discover_jobs: async () => {
        throw new Error('boom');
      },
    });
    q.start();
    const run = q.enqueue('discover_jobs', pid);
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
    const first = q.enqueue('discover_jobs', pid);
    const second = q.enqueue('sync_mail', pid);
    q.start();
    expect((await waitForTerminal(first.id)).error).toBe('sync boom');
    expect((await waitForTerminal(second.id)).status).toBe('succeeded');
  });

  it('returns the existing run when the kind already has a queued run', () => {
    const q = makeQueue({});
    const first = q.enqueue('discover_jobs', pid);
    const second = q.enqueue('discover_jobs', pid);
    expect(second.id).toBe(first.id);
    expect(runsRepo.list(pid)).toHaveLength(1);
  });

  it('stores the requested effort mode and hands it to the handler', async () => {
    const modes: string[] = [];
    const q = makeQueue({
      discover_jobs: async (ctx) => {
        modes.push(ctx.run.effort_mode);
        return { summary: 'ok' };
      },
    });
    const run = q.enqueue('discover_jobs', pid, { effortMode: 'max' });
    expect(run.effort_mode).toBe('max');
    q.start();
    await waitForTerminal(run.id);
    expect(modes).toEqual(['max']);
    expect(q.enqueue('sync_mail', pid).effort_mode).toBe('default');
  });

  it('returns the active run for the same mode and refuses a different mode', () => {
    const q = makeQueue({});
    const first = q.enqueue('discover_jobs', pid);
    expect(q.enqueue('discover_jobs', pid, { effortMode: 'default' }).id).toBe(first.id);
    let caught: unknown;
    try {
      q.enqueue('discover_jobs', pid, { effortMode: 'max' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ActiveRunConflictError);
    expect((caught as ActiveRunConflictError).active.id).toBe(first.id);
    expect(runsRepo.list(pid)).toHaveLength(1);
  });

  it('stores custom instructions on the run and hands them to the handler', async () => {
    const seen: (string | null)[] = [];
    const q = makeQueue({
      discover_jobs: async (ctx) => {
        seen.push(ctx.run.custom_prompt);
        return { summary: 'ok' };
      },
    });
    const run = q.enqueue('discover_jobs', pid, { customPrompt: 'Only fintech companies' });
    expect(run.custom_prompt).toBe('Only fintech companies');
    q.start();
    await waitForTerminal(run.id);
    expect(seen).toEqual(['Only fintech companies']);
    expect(q.enqueue('sync_mail', pid).custom_prompt).toBeNull();
  });

  it('writes the run input to the run folder before the handler reads it', async () => {
    const seen: unknown[] = [];
    const q = makeQueue({
      import_jobs: async (ctx) => {
        seen.push(JSON.parse(readFileSync(join(ctx.runDir, RUN_INPUT_FILE), 'utf8')));
        return { summary: 'ok' };
      },
    });
    const run = q.enqueue('import_jobs', pid, { input: { jobs: [{ company: 'Acme' }] } });
    expect(JSON.parse(readFileSync(join(runsDir, run.id, RUN_INPUT_FILE), 'utf8'))).toEqual({
      jobs: [{ company: 'Acme' }],
    });
    q.start();
    await waitForTerminal(run.id);
    expect(seen).toEqual([{ jobs: [{ company: 'Acme' }] }]);
  });

  it('refuses a second import while one is active, and says so', () => {
    const q = makeQueue({});
    const first = q.enqueue('import_jobs', pid, { input: { jobs: [] } });
    expect(() => q.enqueue('import_jobs', pid, { input: { jobs: [] } })).toThrow('An import is already active');
    expect(runsRepo.list(pid).map((r) => r.id)).toEqual([first.id]);
    // A discovery is another kind, so it still queues behind the import.
    expect(q.enqueue('discover_jobs', pid).kind).toBe('discover_jobs');
  });

  it('treats empty custom instructions as none', () => {
    const q = makeQueue({});
    expect(q.enqueue('discover_jobs', pid, { customPrompt: '' }).custom_prompt).toBeNull();
  });

  it('returns the active run for the same instructions and refuses different ones', () => {
    const q = makeQueue({});
    const first = q.enqueue('discover_jobs', pid, { customPrompt: 'Only fintech companies' });
    expect(q.enqueue('discover_jobs', pid, { customPrompt: 'Only fintech companies' }).id).toBe(first.id);
    for (const customPrompt of ['Only healthcare companies', null, undefined]) {
      expect(() => q.enqueue('discover_jobs', pid, { customPrompt })).toThrow(ActiveRunConflictError);
    }
    expect(runsRepo.list(pid)).toHaveLength(1);
  });

  it('keeps one active run per profile and kind, and runs every profile through the same queue', async () => {
    const other = insertTestProfile(db, 'Other profile');
    const seen: string[] = [];
    const q = makeQueue({
      discover_jobs: async (ctx) => {
        seen.push(ctx.run.profile_id);
        return { summary: 'ok' };
      },
    });
    const mine = q.enqueue('discover_jobs', pid);
    const theirs = q.enqueue('discover_jobs', other);
    expect(theirs.id).not.toBe(mine.id);
    expect(q.enqueue('discover_jobs', other).id).toBe(theirs.id);
    expect(theirs.profile_id).toBe(other);
    q.start();
    await waitForTerminal(mine.id);
    await waitForTerminal(theirs.id);
    expect(seen).toEqual([pid, other]);
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
    const a = q.enqueue('discover_jobs', pid);
    const b = q.enqueue('sync_mail', pid);
    await waitForTerminal(a.id);
    await waitForTerminal(b.id);
    expect(maxActive).toBe(1);
  });

  it('cancels a queued run at once and never starts it', async () => {
    let started = false;
    let release: () => void = () => {};
    const q = makeQueue({
      // Holds the queue busy so the sync run stays queued.
      discover_jobs: () => new Promise((res) => (release = () => res({ summary: 'ok' }))),
      sync_mail: async () => {
        started = true;
        return { summary: 'ran' };
      },
    });
    q.start();
    const busy = q.enqueue('discover_jobs', pid);
    const queued = q.enqueue('sync_mail', pid);
    await waitFor(() => runsRepo.get(busy.id)?.status === 'running');
    expect(q.cancel(queued.id)).toBe('cancelled');
    const cancelled = runsRepo.get(queued.id) as Run;
    expect([cancelled.status, cancelled.error]).toEqual(['aborted', 'Cancelled by user']);
    expect(cancelled.finished_at).not.toBeNull();
    expect(logStore.read(queued.id)).toContain(`Run ${queued.id} aborted: Cancelled by user`);
    release();
    await waitForTerminal(busy.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toBe(false);
    // The kind is free again.
    expect(q.enqueue('sync_mail', pid).id).not.toBe(queued.id);
  });

  it('cancels a running run through its signal and records the reason', async () => {
    let entered = false;
    const q = makeQueue({
      discover_jobs: ({ signal }) => {
        entered = true;
        return new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('Aborted'))));
      },
    });
    q.start();
    const run = q.enqueue('discover_jobs', pid);
    await waitFor(() => entered);
    expect(q.cancel(run.id)).toBe('cancelling');
    // A second request while the agent is being stopped is accepted again.
    expect(q.cancel(run.id)).toBe('cancelling');
    const done = await waitForTerminal(run.id);
    expect([done.status, done.error]).toEqual(['aborted', 'Cancelled by user']);
  });

  it('refuses to cancel once the handler has started saving, and the run succeeds', async () => {
    let saving = false;
    let release: () => void = () => {};
    const q = makeQueue({
      discover_jobs: async ({ beginSaving }) => {
        beginSaving();
        saving = true;
        await new Promise<void>((res) => (release = res));
        return { summary: 'saved' };
      },
    });
    q.start();
    const run = q.enqueue('discover_jobs', pid);
    await waitFor(() => saving);
    expect(q.cancel(run.id)).toBe('saving');
    expect(logStore.read(run.id)).toContain('Saving results; the run can no longer be cancelled');
    release();
    const done = await waitForTerminal(run.id);
    expect([done.status, done.summary]).toEqual(['succeeded', 'saved']);
  });

  it('beginSaving throws when the run was cancelled first, so nothing is saved', async () => {
    let entered = false;
    let saved = false;
    let proceed: () => void = () => {};
    const q = makeQueue({
      discover_jobs: async ({ beginSaving }) => {
        entered = true;
        // Stands in for an agent that finished just as the cancel arrived.
        await new Promise<void>((res) => (proceed = res));
        beginSaving();
        saved = true;
        return { summary: 'saved' };
      },
    });
    q.start();
    const run = q.enqueue('discover_jobs', pid);
    await waitFor(() => entered);
    expect(q.cancel(run.id)).toBe('cancelling');
    proceed();
    const done = await waitForTerminal(run.id);
    expect([done.status, done.error]).toEqual(['aborted', 'Cancelled by user']);
    expect(saved).toBe(false);
  });

  it('keeps the cancel reason when stop() gives up on a cancelled run, and the shutdown reason when cancel comes after stop', async () => {
    let entered = false;
    const q = makeQueue(
      { discover_jobs: () => new Promise(() => void (entered = true)) },
      { stopTimeoutMs: 20 },
    );
    q.start();
    const run = q.enqueue('discover_jobs', pid);
    await waitFor(() => entered);
    expect(q.cancel(run.id)).toBe('cancelling');
    await q.stop();
    expect(runsRepo.get(run.id)?.error).toBe('Cancelled by user');

    queue = null;
    let entered2 = false;
    const q2 = makeQueue(
      {
        discover_jobs: ({ signal }) =>
          new Promise((_, rej) => {
            entered2 = true;
            signal.addEventListener('abort', () => setTimeout(() => rej(new Error('Aborted')), 10));
          }),
      },
      { stopTimeoutMs: 1000 },
    );
    q2.start();
    const run2 = q2.enqueue('discover_jobs', pid);
    await waitFor(() => entered2);
    const stopping = q2.stop();
    q2.cancel(run2.id);
    await stopping;
    expect(runsRepo.get(run2.id)?.error).toBe('Aborted');
  });

  it('queues a new run of the same kind behind a run that is being cancelled', async () => {
    let entered = 0;
    let rejectFirst: () => void = () => {};
    const q = makeQueue({
      discover_jobs: ({ signal }) => {
        entered++;
        if (entered > 1) return Promise.resolve({ summary: 'second' });
        return new Promise((_, rej) => {
          // Stands in for an agent that takes a while to die after the abort.
          signal.addEventListener('abort', () => (rejectFirst = () => rej(new Error('Aborted'))));
        });
      },
    });
    q.start();
    const first = q.enqueue('discover_jobs', pid);
    await waitFor(() => entered === 1);
    // Before any cancel the active run is returned as before.
    expect(q.enqueue('discover_jobs', pid).id).toBe(first.id);
    expect(q.cancel(first.id)).toBe('cancelling');
    const second = q.enqueue('discover_jobs', pid);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('queued');
    // A repeated click returns the queued run instead of piling up more.
    expect(q.enqueue('discover_jobs', pid).id).toBe(second.id);
    rejectFirst();
    expect((await waitForTerminal(first.id)).error).toBe('Cancelled by user');
    expect((await waitForTerminal(second.id)).summary).toBe('second');
  });

  it('queues a second import behind one that is being cancelled, then refuses a third', async () => {
    let entered = 0;
    let rejectFirst: () => void = () => {};
    const q = makeQueue({
      import_jobs: ({ signal }) => {
        entered++;
        if (entered > 1) return Promise.resolve({ summary: 'second' });
        return new Promise((_, rej) => {
          signal.addEventListener('abort', () => (rejectFirst = () => rej(new Error('Aborted'))));
        });
      },
    });
    q.start();
    const first = q.enqueue('import_jobs', pid, { input: { jobs: [] } });
    await waitFor(() => entered === 1);
    expect(q.cancel(first.id)).toBe('cancelling');
    const second = q.enqueue('import_jobs', pid, { input: { jobs: [] } });
    expect(second.id).not.toBe(first.id);
    expect(() => q.enqueue('import_jobs', pid, { input: { jobs: [] } })).toThrow('An import is already active');
    rejectFirst();
    expect((await waitForTerminal(first.id)).error).toBe('Cancelled by user');
    expect((await waitForTerminal(second.id)).summary).toBe('second');
  });

  it('fails the run and rethrows when its input cannot be stored', () => {
    // A file where the runs folder should be makes every write under it fail.
    const blocked = join(mkdtempSync(join(tmpdir(), 'queue-blocked-')), 'runs');
    writeFileSync(blocked, '');
    const q = createRunQueue({
      runsRepo,
      logStore,
      runsDir: blocked,
      handlers: { discover_jobs: noop, sync_mail: noop, import_jobs: noop },
    });
    expect(() => q.enqueue('import_jobs', pid, { input: { jobs: [] } })).toThrow();
    const [run] = runsRepo.list(pid);
    expect(run).toMatchObject({ kind: 'import_jobs', status: 'failed' });
    expect(run!.error).toMatch(/^Could not store the run input: /);
    expect(run!.finished_at).not.toBeNull();
  });

  it('reports finished and unknown runs', async () => {
    const q = makeQueue({});
    q.start();
    const run = q.enqueue('discover_jobs', pid);
    await waitForTerminal(run.id);
    expect(q.cancel(run.id)).toBe('finished');
    expect(q.cancel(randomUUID())).toBe('not_found');
    expect(runsRepo.get(run.id)?.status).toBe('succeeded');
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
    const run = q.enqueue('discover_jobs', pid);
    await waitFor(() => entered);
    expect(q.isRunning()).toBe(true);
    await q.stop();
    const done = runsRepo.get(run.id) as Run;
    expect(done.status).toBe('aborted');
    expect(done.error).toBe('Aborted');
    expect(q.isRunning()).toBe(false);
    // After stop, enqueue still records the run but nothing executes it.
    const later = q.enqueue('sync_mail', pid);
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
    const run = q.enqueue('discover_jobs', pid);
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

  it('purge deletes log files and run directories except kept runs', () => {
    const keep = randomUUID();
    const drop = randomUUID();
    logStore.append(keep, 'k');
    logStore.append(drop, 'd');
    writeFileSync(join(runsDir, 'notes.txt'), 'x');
    mkdirSync(join(runsDir, keep));
    writeFileSync(join(runsDir, keep, 'prompt.md'), 'p');
    mkdirSync(join(runsDir, drop));
    writeFileSync(join(runsDir, drop, 'prompt.md'), 'r');
    // Not a run id, so it is not ours to delete.
    mkdirSync(join(runsDir, 'not.a.run'));
    // One log file plus one run directory.
    expect(logStore.purge(new Set([keep]))).toBe(2);
    expect(readdirSync(runsDir).sort()).toEqual([`${keep}.log`, keep, 'not.a.run', 'notes.txt'].sort());
    expect(existsSync(join(runsDir, drop))).toBe(false);
    expect(existsSync(join(runsDir, keep, 'prompt.md'))).toBe(true);
    expect(logStore.read(drop)).toBe('');
  });

  it('remove deletes the log file and run directory of the given runs only, and skips missing ones', () => {
    const drop = randomUUID();
    const keep = randomUUID();
    for (const id of [drop, keep]) {
      logStore.append(id, 'x');
      mkdirSync(join(runsDir, id));
      writeFileSync(join(runsDir, id, 'prompt.md'), 'p');
    }
    logStore.remove([drop, randomUUID()]);
    expect(readdirSync(runsDir).sort()).toEqual([`${keep}.log`, keep].sort());
    expect(() => logStore.remove(['../escape'])).toThrow('Invalid run id: ../escape');
  });
});
