import { randomUUID } from 'node:crypto';
import type { Run, RunKind } from '../domain/types.js';
import type { Db } from './connection.js';

export type RunPatch = Partial<
  Pick<Run, 'status' | 'started_at' | 'finished_at' | 'summary' | 'error' | 'prompt_version' | 'adapter_id'>
>;

// Runtime allow-list: patch keys become column names in the UPDATE.
const PATCHABLE = new Set<string>([
  'status',
  'started_at',
  'finished_at',
  'summary',
  'error',
  'prompt_version',
  'adapter_id',
]);

export function createRunsRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO runs (id, kind, status, started_at, finished_at, adapter_id, prompt_version,
       summary, error, created_at)
     VALUES (@id, @kind, 'queued', NULL, NULL, @adapter_id, @prompt_version, NULL, NULL, @created_at)`,
  );
  const selectById = db.prepare('SELECT * FROM runs WHERE id = ?');
  const selectRecent = db.prepare('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT ?');
  const selectNextQueued = db.prepare(
    "SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1",
  );
  const selectActive = db.prepare(
    `SELECT * FROM runs WHERE kind = ? AND status IN ('queued','running')
     ORDER BY created_at ASC, rowid ASC LIMIT 1`,
  );
  const interruptRunning = db.prepare(
    "UPDATE runs SET status = 'aborted', error = 'server restarted', finished_at = ? WHERE status = 'running'",
  );

  function get(id: string): Run | null {
    return (selectById.get(id) as Run | undefined) ?? null;
  }

  function create(kind: RunKind, meta: { adapter_id: string; prompt_version: string | null }): Run {
    const id = randomUUID();
    insert.run({
      id,
      kind,
      adapter_id: meta.adapter_id,
      prompt_version: meta.prompt_version,
      created_at: new Date().toISOString(),
    });
    return get(id) as Run;
  }

  function update(id: string, patch: RunPatch): Run {
    if (!get(id)) throw new Error(`Run not found: ${id}`);
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || !PATCHABLE.has(key)) continue;
      sets.push(`${key} = @${key}`);
      params[key] = value;
    }
    if (sets.length) db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = @id`).run(params);
    return get(id) as Run;
  }

  function list(limit = 50): Run[] {
    return selectRecent.all(limit) as Run[];
  }

  function nextQueued(): Run | null {
    return (selectNextQueued.get() as Run | undefined) ?? null;
  }

  // Called once at startup: nothing can still be executing a run from a previous process.
  function markInterrupted(): number {
    return interruptRunning.run(new Date().toISOString()).changes;
  }

  function findActive(kind: RunKind): Run | null {
    return (selectActive.get(kind) as Run | undefined) ?? null;
  }

  function hasActive(kind: RunKind): boolean {
    return findActive(kind) !== null;
  }

  return { create, update, get, list, nextQueued, markInterrupted, findActive, hasActive };
}

export type RunsRepo = ReturnType<typeof createRunsRepo>;
