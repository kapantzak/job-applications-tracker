import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRunRecord, RunPatch, RunsRepo } from '../db/runs-repo.js';
import { RUN_SAVING_LOG_LINE, type Run, type RunKind } from '../domain/types.js';
import type { LogStore } from './log-store.js';

export interface RunContext {
  run: Run;
  log: (line: string) => void;
  signal: AbortSignal;
  runDir: string;
  // Writes agent, model and effort to the run row immediately; never throws.
  recordAgent: (record: AgentRunRecord) => void;
  // Called once the agent's result is in hand: from here on the run cannot be cancelled. Throws
  // 'Aborted' when a cancel or shutdown came first, so a late result is never saved.
  beginSaving: () => void;
}

export interface RunResult {
  summary: string;
  promptVersion?: string;
  // The adapter that actually ran; runs are created before one is chosen.
  adapterId?: string;
}

export type RunHandler = (ctx: RunContext) => Promise<RunResult>;

export interface RunQueueOptions {
  runsRepo: RunsRepo;
  logStore: LogStore;
  runsDir: string;
  handlers: Record<RunKind, RunHandler>;
  // Test seam; production uses the 10 s default.
  stopTimeoutMs?: number;
}

const DEFAULT_STOP_TIMEOUT_MS = 10_000;
const CANCELLED_BY_USER = 'Cancelled by user';

// cancelled: a queued run was stopped before it started; cancelling: the running agent is being
// stopped; saving: too late, results are being saved; finished: already terminal.
export type CancelOutcome = 'cancelled' | 'cancelling' | 'saving' | 'finished' | 'not_found';

type Outcome = Required<Pick<RunPatch, 'status'>> & RunPatch;

interface InFlight {
  id: string;
  controller: AbortController;
  // Set once the terminal status is written so a late settle cannot overwrite it.
  finalized: boolean;
  saving: boolean;
  // Error recorded when the abort came from a user cancel rather than shutdown.
  cancelReason?: string;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createRunQueue(opts: RunQueueOptions) {
  const { runsRepo, logStore, runsDir, handlers } = opts;
  const stopTimeoutMs = opts.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  let started = false;
  let stopping = false;
  let draining = false;
  let drainDone: Promise<void> = Promise.resolve();
  let current: InFlight | null = null;

  function now(): string {
    return new Date().toISOString();
  }

  function safeLog(runId: string, line: string): void {
    try {
      logStore.append(runId, line);
    } catch (err) {
      console.error(`run ${runId}: failed to write log line: ${messageOf(err)}`);
    }
  }

  function finish(entry: InFlight, outcome: Outcome): void {
    if (entry.finalized) return;
    entry.finalized = true;
    try {
      runsRepo.update(entry.id, { ...outcome, finished_at: now() });
    } catch (err) {
      console.error(`run ${entry.id}: failed to record ${outcome.status}: ${messageOf(err)}`);
    }
    safeLog(entry.id, `Run ${entry.id} ${outcome.status}: ${outcome.summary ?? outcome.error ?? ''}`);
  }

  // Metadata only: a failed write is logged and must not fail the run.
  function recordAgent(runId: string, record: AgentRunRecord): void {
    try {
      runsRepo.update(runId, record);
    } catch (err) {
      console.error(`run ${runId}: failed to record agent details: ${messageOf(err)}`);
    }
  }

  async function execute(queued: Run): Promise<void> {
    const entry: InFlight = { id: queued.id, controller: new AbortController(), finalized: false, saving: false };
    current = entry;
    try {
      const run = runsRepo.update(queued.id, { status: 'running', started_at: now() });
      safeLog(run.id, `Run ${run.id} (${run.kind}) started`);
      let outcome: Outcome;
      try {
        const runDir = join(runsDir, run.id);
        mkdirSync(runDir, { recursive: true });
        const handler = handlers[run.kind];
        if (typeof handler !== 'function') throw new Error(`No handler for run kind: ${run.kind}`);
        const result = await handler({
          run,
          log: (line) => logStore.append(run.id, line),
          signal: entry.controller.signal,
          runDir,
          recordAgent: (record) => recordAgent(run.id, record),
          beginSaving: () => {
            if (entry.controller.signal.aborted) throw new Error('Aborted');
            entry.saving = true;
            safeLog(run.id, RUN_SAVING_LOG_LINE);
          },
        });
        outcome = {
          status: 'succeeded',
          summary: result.summary,
          prompt_version: result.promptVersion ?? run.prompt_version,
          adapter_id: result.adapterId,
        };
      } catch (err) {
        outcome = entry.controller.signal.aborted
          ? { status: 'aborted', error: entry.cancelReason ?? 'Aborted' }
          : { status: 'failed', error: messageOf(err) };
      }
      finish(entry, outcome);
    } catch (err) {
      // Repository failures outside the handler: record what we can and keep the loop alive.
      finish(entry, { status: 'failed', error: messageOf(err) });
    } finally {
      if (current === entry) current = null;
    }
  }

  async function drain(): Promise<void> {
    // Defer so enqueue() never runs handler code on the caller's stack.
    await Promise.resolve();
    try {
      let previous: string | null = null;
      while (!stopping) {
        const next = runsRepo.nextQueued();
        if (!next) break;
        // The same row twice means its status could not be written; stop rather than spin.
        if (next.id === previous) {
          console.error(`run queue: run ${next.id} is stuck in queued; draining paused`);
          break;
        }
        previous = next.id;
        await execute(next);
      }
    } catch (err) {
      console.error(`run queue: drain stopped: ${messageOf(err)}`);
    } finally {
      // Cleared in the same tick the loop exits, so a concurrent enqueue always re-kicks.
      draining = false;
    }
  }

  function kick(): void {
    if (!started || stopping || draining) return;
    draining = true;
    drainDone = drain();
  }

  function enqueue(kind: RunKind): Run {
    let active = runsRepo.findActive(kind);
    // A run being cancelled no longer counts: the new request queues behind it (user decision, SOW-0012).
    if (active && current?.id === active.id && current.cancelReason) {
      active = runsRepo.findActiveExcept(kind, active.id);
    }
    if (active) return active;
    const run = runsRepo.create(kind, { adapter_id: '', prompt_version: null });
    kick();
    return run;
  }

  function cancel(id: string): CancelOutcome {
    const entry = current;
    if (entry && entry.id === id && !entry.finalized) {
      if (entry.saving) return 'saving';
      // During shutdown the run is already being aborted; keep the shutdown reason.
      if (stopping) return 'cancelling';
      entry.cancelReason ??= CANCELLED_BY_USER;
      entry.controller.abort();
      return 'cancelling';
    }
    const run = runsRepo.get(id);
    if (!run) return 'not_found';
    // Synchronous read-then-write: the drain loop cannot pick the row up in between.
    if (run.status === 'queued') {
      runsRepo.update(id, { status: 'aborted', error: CANCELLED_BY_USER, finished_at: now() });
      safeLog(id, `Run ${id} aborted: ${CANCELLED_BY_USER}`);
      return 'cancelled';
    }
    // 'running' without an in-flight entry is a row this process does not own; treat it as done.
    return 'finished';
  }

  function start(): void {
    if (started) return;
    started = true;
    runsRepo.markInterrupted();
    kick();
  }

  async function stop(): Promise<void> {
    stopping = true;
    const entry = current;
    if (!entry) {
      await drainDone;
      return;
    }
    entry.controller.abort();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), stopTimeoutMs);
    });
    const gaveUp = await Promise.race([drainDone.then(() => false), timedOut]);
    clearTimeout(timer);
    if (gaveUp) finish(entry, { status: 'aborted', error: entry.cancelReason ?? 'Aborted' });
  }

  function isRunning(): boolean {
    return current !== null;
  }

  return { enqueue, cancel, start, stop, isRunning };
}

export type RunQueue = ReturnType<typeof createRunQueue>;
