import { randomUUID } from 'node:crypto';
import type { Job } from '../domain/types.js';
import type { Db } from './connection.js';

export type NewJob = Omit<Job, 'id' | 'run_id' | 'dismissed_at' | 'created_at'>;

export interface ListJobsOptions {
  includeDead?: boolean;
  includeDismissed?: boolean;
}

export function createJobsRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO jobs (id, run_id, company, title, location, remote, url, canonical_url, source_site,
       posted_at, salary, description_excerpt, match_reason, verification_status, verified_at,
       dedupe_key, created_at)
     VALUES (@id, @run_id, @company, @title, @location, @remote, @url, @canonical_url, @source_site,
       @posted_at, @salary, @description_excerpt, @match_reason, @verification_status, @verified_at,
       @dedupe_key, @created_at)`,
  );
  const selectById = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const keyExists = db.prepare('SELECT 1 FROM jobs WHERE dedupe_key = ?');
  const allKeys = db.prepare('SELECT dedupe_key FROM jobs');
  const dismissStmt = db.prepare('UPDATE jobs SET dismissed_at = ? WHERE id = ?');
  const recentUrls = db.prepare(
    `SELECT canonical_url FROM jobs WHERE canonical_url IS NOT NULL
     GROUP BY canonical_url ORDER BY MAX(created_at) DESC, MAX(rowid) DESC LIMIT ?`,
  );

  function get(id: string): Job | null {
    return (selectById.get(id) as Job | undefined) ?? null;
  }

  function insertMany(runId: string, jobs: NewJob[]): Job[] {
    return db.transaction(() => {
      const inserted: Job[] = [];
      for (const job of jobs) {
        // Explicit check (also covers duplicates inside one batch) instead of catching UNIQUE errors.
        if (keyExists.get(job.dedupe_key)) continue;
        const id = randomUUID();
        insert.run({
          ...job,
          id,
          run_id: runId,
          created_at: new Date().toISOString(),
        });
        inserted.push(get(id) as Job);
      }
      return inserted;
    })();
  }

  function list(opts: ListJobsOptions = {}): Job[] {
    const where: string[] = [];
    if (!opts.includeDead) where.push("verification_status != 'dead'");
    if (!opts.includeDismissed) where.push('dismissed_at IS NULL');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // rowid tiebreak keeps same-millisecond inserts newest first.
    return db
      .prepare(`SELECT * FROM jobs ${clause} ORDER BY created_at DESC, rowid DESC`)
      .all() as Job[];
  }

  function dismiss(id: string): void {
    dismissStmt.run(new Date().toISOString(), id);
  }

  function existingDedupeKeys(): Set<string> {
    return new Set((allKeys.all() as { dedupe_key: string }[]).map((r) => r.dedupe_key));
  }

  function recentCanonicalUrls(limit: number): string[] {
    return (recentUrls.all(limit) as { canonical_url: string }[]).map((r) => r.canonical_url);
  }

  return { insertMany, list, get, dismiss, existingDedupeKeys, recentCanonicalUrls };
}
