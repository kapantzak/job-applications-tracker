import { randomUUID } from 'node:crypto';
import type { CvAnalysis, CvAnalysisStatus, CvFileType, CvProfileDraft } from '../domain/types.js';
import type { Db } from './connection.js';

interface CvAnalysisRow {
  id: string;
  status: CvAnalysisStatus;
  file_name: string;
  file_type: CvFileType;
  started_at: string;
  finished_at: string | null;
  draft: string | null;
  error: string | null;
  prompt_version: string | null;
  created_at: string;
}

export type CvAnalysisPatch = Partial<Pick<CvAnalysis, 'status' | 'started_at' | 'finished_at' | 'draft' | 'error'>> & {
  prompt_version?: string | null;
};

function fromRow(row: CvAnalysisRow): CvAnalysis {
  return {
    id: row.id,
    status: row.status,
    file_name: row.file_name,
    file_type: row.file_type,
    started_at: row.started_at,
    finished_at: row.finished_at,
    draft: row.draft ? (JSON.parse(row.draft) as CvProfileDraft) : null,
    error: row.error,
    created_at: row.created_at,
  };
}

// Rows for the one CV analysis that may exist at a time (SOW-0023, decision 24). The service enforces
// "one"; the table itself allows more so a crash between two writes never blocks a new upload.
export function createCvAnalysesRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO cv_analyses (id, status, file_name, file_type, started_at, created_at)
     VALUES (@id, 'running', @file_name, @file_type, @now, @now)`,
  );
  const selectById = db.prepare('SELECT * FROM cv_analyses WHERE id = ?');
  const selectLatest = db.prepare('SELECT * FROM cv_analyses ORDER BY created_at DESC, rowid DESC LIMIT 1');
  const selectIds = db.prepare('SELECT id FROM cv_analyses');
  const deleteById = db.prepare('DELETE FROM cv_analyses WHERE id = ?');
  const interruptRunning = db.prepare(
    "UPDATE cv_analyses SET status = 'interrupted', error = 'The app stopped while the CV was being analysed', finished_at = ? WHERE status = 'running'",
  );
  const updateStmt = db.prepare(
    `UPDATE cv_analyses SET status = @status, started_at = @started_at, finished_at = @finished_at, draft = @draft,
       error = @error, prompt_version = @prompt_version WHERE id = @id`,
  );

  function get(id: string): CvAnalysis | null {
    const row = selectById.get(id) as CvAnalysisRow | undefined;
    return row ? fromRow(row) : null;
  }

  function current(): CvAnalysis | null {
    const row = selectLatest.get() as CvAnalysisRow | undefined;
    return row ? fromRow(row) : null;
  }

  function create(input: { file_name: string; file_type: CvFileType }, id: string = randomUUID()): CvAnalysis {
    insert.run({ ...input, id, now: new Date().toISOString() });
    return get(id) as CvAnalysis;
  }

  function update(id: string, patch: CvAnalysisPatch): CvAnalysis | null {
    const row = selectById.get(id) as CvAnalysisRow | undefined;
    if (!row) return null;
    let draft = row.draft;
    if (patch.draft !== undefined) draft = patch.draft === null ? null : JSON.stringify(patch.draft);
    updateStmt.run({ ...row, ...patch, draft });
    return get(id);
  }

  function remove(id: string): boolean {
    return deleteById.run(id).changes > 0;
  }

  function ids(): string[] {
    return (selectIds.all() as { id: string }[]).map((r) => r.id);
  }

  // At start-up: no agent of an earlier process is still running, and none is restarted (decision 26).
  function markInterrupted(): number {
    return interruptRunning.run(new Date().toISOString()).changes;
  }

  return { get, current, create, update, remove, ids, markInterrupted };
}

export type CvAnalysesRepo = ReturnType<typeof createCvAnalysesRepo>;
