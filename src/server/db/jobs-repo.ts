import { randomUUID } from 'node:crypto';
import type { Job, JobListItem } from '../domain/types.js';
import type { Db } from './connection.js';

export type NewJob = Omit<Job, 'id' | 'profile_id' | 'run_id' | 'dismissed_at' | 'created_at'>;

export interface ListJobsOptions {
  includeDead?: boolean;
  includeDismissed?: boolean;
}

export function createJobsRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO jobs (id, profile_id, run_id, company, title, location, remote, url, canonical_url, source_site,
       posted_at, salary, description_excerpt, match_reason, verification_status, verified_at,
       dedupe_key, created_at)
     VALUES (@id, @profile_id, @run_id, @company, @title, @location, @remote, @url, @canonical_url, @source_site,
       @posted_at, @salary, @description_excerpt, @match_reason, @verification_status, @verified_at,
       @dedupe_key, @created_at)`,
  );
  const selectById = db.prepare('SELECT * FROM jobs WHERE id = ?');
  // Dedupe is per profile: the same posting may be stored once in each profile (SOW-0014).
  const keyExists = db.prepare('SELECT 1 FROM jobs WHERE profile_id = ? AND dedupe_key = ?');
  const allKeys = db.prepare('SELECT dedupe_key FROM jobs WHERE profile_id = ?');
  const runProfile = db.prepare('SELECT profile_id FROM runs WHERE id = ?');
  const dismissStmt = db.prepare('UPDATE jobs SET dismissed_at = ? WHERE id = ?');
  const recentUrls = db.prepare(
    `SELECT canonical_url FROM jobs WHERE profile_id = ? AND canonical_url IS NOT NULL
     GROUP BY canonical_url ORDER BY MAX(created_at) DESC, MAX(rowid) DESC LIMIT ?`,
  );

  function get(id: string): Job | null {
    return (selectById.get(id) as Job | undefined) ?? null;
  }

  // Jobs belong to the profile of the run that found them.
  function insertMany(runId: string, jobs: NewJob[]): Job[] {
    return db.transaction(() => {
      const owner = runProfile.get(runId) as { profile_id: string } | undefined;
      if (!owner) throw new Error(`Run not found: ${runId}`);
      const inserted: Job[] = [];
      for (const job of jobs) {
        // Explicit check (also covers duplicates inside one batch) instead of catching UNIQUE errors.
        if (keyExists.get(owner.profile_id, job.dedupe_key)) continue;
        const id = randomUUID();
        insert.run({
          ...job,
          id,
          profile_id: owner.profile_id,
          run_id: runId,
          created_at: new Date().toISOString(),
        });
        inserted.push(get(id) as Job);
      }
      return inserted;
    })();
  }

  function list(profileId: string, opts: ListJobsOptions = {}): JobListItem[] {
    const where: string[] = ['j.profile_id = ?'];
    if (!opts.includeDead) where.push("j.verification_status != 'dead'");
    if (!opts.includeDismissed) where.push('j.dismissed_at IS NULL');
    const clause = `WHERE ${where.join(' AND ')}`;
    // Latest application per job, same ordering as applicationsRepo.findByJobId.
    // rowid tiebreak keeps same-millisecond inserts newest first.
    return db
      .prepare(
        `SELECT j.*,
           (SELECT a.status FROM applications a WHERE a.job_id = j.id
            ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1) AS application_status
         FROM jobs j ${clause} ORDER BY j.created_at DESC, j.rowid DESC`,
      )
      .all(profileId) as JobListItem[];
  }

  function dismiss(id: string): void {
    dismissStmt.run(new Date().toISOString(), id);
  }

  function existingDedupeKeys(profileId: string): Set<string> {
    return new Set((allKeys.all(profileId) as { dedupe_key: string }[]).map((r) => r.dedupe_key));
  }

  function recentCanonicalUrls(profileId: string, limit: number): string[] {
    return (recentUrls.all(profileId, limit) as { canonical_url: string }[]).map((r) => r.canonical_url);
  }

  return { insertMany, list, get, dismiss, existingDedupeKeys, recentCanonicalUrls };
}
