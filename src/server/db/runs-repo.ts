import { randomUUID } from 'node:crypto';
import type { Run, RunKind } from '../domain/types.js';
import type { Db } from './connection.js';

export type RunPatch = Partial<
  Pick<
    Run,
    | 'status'
    | 'started_at'
    | 'finished_at'
    | 'summary'
    | 'error'
    | 'prompt_version'
    | 'adapter_id'
    | 'agent_model'
    | 'agent_effort'
    | 'agent_model_reported'
  >
>;

// What a handler records about the agent call, as soon as it knows it.
export type AgentRunRecord = Pick<RunPatch, 'adapter_id' | 'agent_model' | 'agent_effort' | 'agent_model_reported'>;

// Runtime allow-list: patch keys become column names in the UPDATE.
const PATCHABLE = new Set<string>([
  'status',
  'started_at',
  'finished_at',
  'summary',
  'error',
  'prompt_version',
  'adapter_id',
  'agent_model',
  'agent_effort',
  'agent_model_reported',
]);

export function createRunsRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO runs (id, profile_id, kind, status, started_at, finished_at, adapter_id, prompt_version,
       summary, error, created_at)
     VALUES (@id, @profile_id, @kind, 'queued', NULL, NULL, @adapter_id, @prompt_version, NULL, NULL, @created_at)`,
  );
  const selectById = db.prepare('SELECT * FROM runs WHERE id = ?');
  const selectRecent = db.prepare(
    'SELECT * FROM runs WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
  );
  const selectNextQueued = db.prepare(
    "SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1",
  );
  const selectActive = db.prepare(
    `SELECT * FROM runs WHERE kind = ? AND profile_id = ? AND status IN ('queued','running')
     ORDER BY created_at ASC, rowid ASC LIMIT 1`,
  );
  const selectActiveExcept = db.prepare(
    `SELECT * FROM runs WHERE kind = ? AND profile_id = ? AND id != ? AND status IN ('queued','running')
     ORDER BY created_at ASC, rowid ASC LIMIT 1`,
  );
  const selectActiveForProfile = db.prepare(
    "SELECT 1 FROM runs WHERE profile_id = ? AND status IN ('queued','running') LIMIT 1",
  );
  const selectActiveIds = db.prepare("SELECT id FROM runs WHERE status IN ('queued','running')");
  const interruptRunning = db.prepare(
    "UPDATE runs SET status = 'aborted', error = 'server restarted', finished_at = ? WHERE status = 'running'",
  );

  function get(id: string): Run | null {
    return (selectById.get(id) as Run | undefined) ?? null;
  }

  function create(
    kind: RunKind,
    profileId: string,
    meta: { adapter_id: string; prompt_version: string | null },
  ): Run {
    const id = randomUUID();
    insert.run({
      id,
      profile_id: profileId,
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

  function list(profileId: string, limit = 50): Run[] {
    return selectRecent.all(profileId, limit) as Run[];
  }

  function nextQueued(): Run | null {
    return (selectNextQueued.get() as Run | undefined) ?? null;
  }

  // Called once at startup: nothing can still be executing a run from a previous process.
  function markInterrupted(): number {
    return interruptRunning.run(new Date().toISOString()).changes;
  }

  // "Already active" is per profile and kind (SOW-0014); the queue itself stays global.
  function findActive(kind: RunKind, profileId: string): Run | null {
    return (selectActive.get(kind, profileId) as Run | undefined) ?? null;
  }

  // Used while one run of the kind is being cancelled: another active run may be queued behind it.
  function findActiveExcept(kind: RunKind, profileId: string, excludeId: string): Run | null {
    return (selectActiveExcept.get(kind, profileId, excludeId) as Run | undefined) ?? null;
  }

  function hasActive(kind: RunKind, profileId: string): boolean {
    return findActive(kind, profileId) !== null;
  }

  function hasActiveForProfile(profileId: string): boolean {
    return selectActiveForProfile.get(profileId) !== undefined;
  }

  function listActiveIds(): string[] {
    return (selectActiveIds.all() as { id: string }[]).map((r) => r.id);
  }

  return {
    create,
    update,
    get,
    list,
    nextQueued,
    markInterrupted,
    findActive,
    findActiveExcept,
    hasActive,
    hasActiveForProfile,
    listActiveIds,
  };
}

export type RunsRepo = ReturnType<typeof createRunsRepo>;
