import { randomUUID } from 'node:crypto';
import type { FitChecks, Job, JobListItem, VerificationStatus } from '../domain/types.js';
import type { Db } from './connection.js';

export type NewJob = Omit<
  Job,
  'id' | 'profile_id' | 'run_id' | 'dismissed_at' | 'created_at' | 'last_seen_at' | 'last_seen_run_id'
>;

// A stored job that a later search returned again (SOW-0040).
export interface Sighting {
  dedupe_key: string;
  // The fresh link check, or null to keep the stored one because the check was inconclusive.
  verification: { status: VerificationStatus; verified_at: string } | null;
}

type Row<T> = Omit<T, 'fit_checks'> & { fit_checks: string | null };

// fit_checks is JSON text; a row that does not parse shows no verdicts rather than failing the list.
function parseFitChecks(text: string | null): FitChecks | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as FitChecks) : null;
  } catch {
    return null;
  }
}

function fromRow<T extends Job>(row: Row<T>): T {
  return { ...row, fit_checks: parseFitChecks(row.fit_checks) } as T;
}

export interface ListJobsOptions {
  includeDead?: boolean;
  includeDismissed?: boolean;
}

export function createJobsRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO jobs (id, profile_id, run_id, company, title, location, remote, url, canonical_url, source_site,
       posted_at, salary, description_excerpt, match_reason, fit_checks, verification_status, verified_at,
       dedupe_key, created_at, last_seen_at, last_seen_run_id)
     VALUES (@id, @profile_id, @run_id, @company, @title, @location, @remote, @url, @canonical_url, @source_site,
       @posted_at, @salary, @description_excerpt, @match_reason, @fit_checks, @verification_status, @verified_at,
       @dedupe_key, @created_at, @created_at, @run_id)`,
  );
  const markSeen = db.prepare(
    `UPDATE jobs SET last_seen_at = @seen_at, last_seen_run_id = @run_id,
       verification_status = COALESCE(@status, verification_status),
       verified_at = CASE WHEN @status IS NULL THEN verified_at ELSE @verified_at END
     WHERE profile_id = @profile_id AND dedupe_key = @dedupe_key`,
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
    const row = selectById.get(id) as Row<Job> | undefined;
    return row ? fromRow(row) : null;
  }

  // Jobs belong to the profile of the run that found them. Found-again jobs are updated in the same
  // transaction, so a search's results are saved whole or not at all.
  function insertMany(runId: string, jobs: NewJob[], seenAgain: Sighting[] = []): Job[] {
    return db.transaction(() => {
      const owner = runProfile.get(runId) as { profile_id: string } | undefined;
      if (!owner) throw new Error(`Run not found: ${runId}`);
      const seenAt = new Date().toISOString();
      for (const sighting of seenAgain) {
        markSeen.run({
          seen_at: seenAt,
          run_id: runId,
          profile_id: owner.profile_id,
          dedupe_key: sighting.dedupe_key,
          status: sighting.verification?.status ?? null,
          verified_at: sighting.verification?.verified_at ?? null,
        });
      }
      const inserted: Job[] = [];
      for (const job of jobs) {
        // Explicit check (also covers duplicates inside one batch) instead of catching UNIQUE errors.
        if (keyExists.get(owner.profile_id, job.dedupe_key)) continue;
        const id = randomUUID();
        insert.run({
          ...job,
          fit_checks: job.fit_checks ? JSON.stringify(job.fit_checks) : null,
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
            ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1) AS application_status,
           r.started_at AS run_started_at, r.effort_mode AS run_effort_mode
         FROM jobs j JOIN runs r ON r.id = j.run_id ${clause} ORDER BY j.created_at DESC, j.rowid DESC`,
      )
      .all(profileId)
      .map((row) => fromRow(row as Row<JobListItem>));
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
