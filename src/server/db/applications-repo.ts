import { randomUUID } from 'node:crypto';
import type {
  Application,
  ApplicationStatus,
  HistorySource,
  StatusHistoryEntry,
} from '../domain/types.js';
import type { Db } from './connection.js';

export type NewApplication = {
  profile_id: string;
  job_id?: string | null;
  company: string;
  role: string;
  url?: string | null;
  status?: ApplicationStatus;
  applied_at?: string | null;
  notes?: string;
  sender_domains?: string[];
};

export type ApplicationPatch = Partial<
  Pick<Application, 'company' | 'role' | 'url' | 'notes' | 'sender_domains' | 'applied_at'>
>;

// Job boards and ATS hosts send mail from their own domains, so they say nothing about the employer.
export const ATS_DOMAINS: readonly string[] = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkday.com',
  'workdayjobs.com',
  'smartrecruiters.com',
  'linkedin.com',
  'indeed.com',
];

const OPEN_STATUSES = ['applied', 'screening', 'interview', 'no_response'];
const OFFER_WINDOW_MS = 30 * 24 * 3600 * 1000;

export function inferSenderDomain(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.startsWith('www.')) host = host.slice(4);
  if (!host) return null;
  if (ATS_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  return host;
}

type AppRow = Omit<Application, 'sender_domains'> & { sender_domains: string };

function toApplication(row: AppRow): Application {
  return { ...row, sender_domains: JSON.parse(row.sender_domains) as string[] };
}

export function createApplicationsRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO applications (id, profile_id, job_id, company, role, url, status, applied_at,
       status_changed_at, notes, sender_domains, created_at)
     VALUES (@id, @profile_id, @job_id, @company, @role, @url, @status, @applied_at,
       @status_changed_at, @notes, @sender_domains, @created_at)`,
  );
  const selectById = db.prepare('SELECT * FROM applications WHERE id = ?');
  const insertHistory = db.prepare(
    `INSERT INTO status_history (id, application_id, from_status, to_status, changed_at,
       source, proposal_id, created_at)
     VALUES (@id, @application_id, @from_status, @to_status, @changed_at,
       @source, @proposal_id, @created_at)`,
  );
  const updateStatus = db.prepare(
    'UPDATE applications SET status = ?, status_changed_at = ? WHERE id = ?',
  );
  const selectHistory = db.prepare(
    'SELECT * FROM status_history WHERE application_id = ? ORDER BY changed_at ASC, rowid ASC',
  );

  // One read for the dashboard; rowid breaks ties between changes made in the same millisecond.
  const selectProfileHistory = db.prepare(
    `SELECT h.* FROM status_history h JOIN applications a ON a.id = h.application_id
     WHERE a.profile_id = ? ORDER BY h.changed_at ASC, h.rowid ASC`,
  );

  function get(id: string): Application | null {
    const row = selectById.get(id) as AppRow | undefined;
    return row ? toApplication(row) : null;
  }

  function require(id: string): Application {
    const app = get(id);
    if (!app) throw new Error(`Application not found: ${id}`);
    return app;
  }

  function create(input: NewApplication): Application {
    const now = new Date().toISOString();
    const status = input.status ?? 'applied';
    let appliedAt: string | null;
    if (status === 'saved') appliedAt = null;
    else if (input.applied_at !== undefined) appliedAt = input.applied_at;
    else appliedAt = status === 'applied' ? now : null;
    const id = randomUUID();
    insert.run({
      id,
      profile_id: input.profile_id,
      job_id: input.job_id ?? null,
      company: input.company,
      role: input.role,
      url: input.url ?? null,
      status,
      applied_at: appliedAt,
      status_changed_at: now,
      notes: input.notes ?? null,
      sender_domains: JSON.stringify(input.sender_domains ?? []),
      created_at: now,
    });
    return get(id) as Application;
  }

  function findByJobId(jobId: string): Application | null {
    const row = db
      .prepare('SELECT * FROM applications WHERE job_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(jobId) as AppRow | undefined;
    return row ? toApplication(row) : null;
  }

  function list(profileId: string, filter: { open?: boolean } = {}): Application[] {
    // rowid tiebreak keeps same-millisecond inserts newest first.
    const order = 'ORDER BY created_at DESC, rowid DESC';
    if (!filter.open) {
      return (
        db.prepare(`SELECT * FROM applications WHERE profile_id = ? ${order}`).all(profileId) as AppRow[]
      ).map(toApplication);
    }
    const cutoff = new Date(Date.now() - OFFER_WINDOW_MS).toISOString();
    const marks = OPEN_STATUSES.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT * FROM applications
         WHERE profile_id = ?
           AND (status IN (${marks}) OR (status = 'offer' AND status_changed_at >= ?))
         ${order}`,
      )
      .all(profileId, ...OPEN_STATUSES, cutoff) as AppRow[];
    return rows.map(toApplication);
  }

  // Profiles the scheduled mail sync should check: those with at least one open application, using the
  // same rule as list({ open: true }). Ordered by profile name for a stable queue order.
  function profileIdsWithOpen(): string[] {
    const cutoff = new Date(Date.now() - OFFER_WINDOW_MS).toISOString();
    const marks = OPEN_STATUSES.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT p.id FROM profiles p
         WHERE EXISTS (
           SELECT 1 FROM applications a WHERE a.profile_id = p.id
             AND (a.status IN (${marks}) OR (a.status = 'offer' AND a.status_changed_at >= ?)))
         ORDER BY p.name COLLATE NOCASE ASC, p.rowid ASC`,
      )
      .all(...OPEN_STATUSES, cutoff) as { id: string }[];
    return rows.map((r) => r.id);
  }

  function update(id: string, patch: ApplicationPatch): Application {
    require(id);
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      sets.push(`${key} = @${key}`);
      params[key] = key === 'sender_domains' ? JSON.stringify(value) : value;
    }
    if (sets.length) {
      // Column names come from the typed patch keys, never from user input.
      db.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }
    return get(id) as Application;
  }

  function setStatus(
    id: string,
    to: ApplicationStatus,
    source: HistorySource,
    proposalId?: string,
  ): Application {
    return db.transaction(() => {
      const current = require(id);
      if (current.status === to) return current;
      const now = new Date().toISOString();
      insertHistory.run({
        id: randomUUID(),
        application_id: id,
        from_status: current.status,
        to_status: to,
        changed_at: now,
        source,
        proposal_id: proposalId ?? null,
        created_at: now,
      });
      updateStatus.run(to, now, id);
      return get(id) as Application;
    })();
  }

  function history(id: string): StatusHistoryEntry[] {
    return selectHistory.all(id) as StatusHistoryEntry[];
  }

  function historyForProfile(profileId: string): StatusHistoryEntry[] {
    return selectProfileHistory.all(profileId) as StatusHistoryEntry[];
  }

  return { create, get, findByJobId, list, profileIdsWithOpen, update, setStatus, history, historyForProfile };
}
