import { randomUUID } from 'node:crypto';
import type {
  Application,
  ApplicationAlias,
  ApplicationStatus,
  HistorySource,
  StatusHistoryEntry,
} from '../domain/types.js';
import { aliasesToKeep, mergedFields } from '../domain/merge.js';
import { stageOf } from '../domain/stage.js';
import { ATS_DOMAINS } from '../domain/ats-domains.js';
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
  // An application found in old mail last changed then, not now (SOW-0045, decision 16A).
  status_changed_at?: string;
};

export type ApplicationPatch = Partial<
  Pick<Application, 'company' | 'role' | 'url' | 'notes' | 'sender_domains' | 'applied_at'>
>;

// Kept here for existing importers; the list lives in a domain module so the UI bundle never loads this file.
export { ATS_DOMAINS };

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

  const selectAliases = db.prepare(
    'SELECT company, role FROM application_aliases WHERE application_id = ? ORDER BY created_at ASC, rowid ASC',
  );
  const selectProfileAliases = db.prepare(
    `SELECT l.application_id, l.company, l.role FROM application_aliases l
     JOIN applications a ON a.id = l.application_id
     WHERE a.profile_id = ? ORDER BY l.created_at ASC, l.rowid ASC`,
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
      status_changed_at: input.status_changed_at ?? now,
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

  // Profiles the scheduled mail sync should check: those with at least one open application (the same rule
  // as list({ open: true })), and those with a Gmail scope, where sync also finds new applications
  // (SOW-0045, decision 9). Ordered by profile name for a stable queue order.
  function profileIdsToSync(): string[] {
    const cutoff = new Date(Date.now() - OFFER_WINDOW_MS).toISOString();
    const marks = OPEN_STATUSES.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT p.id FROM profiles p
         WHERE trim(p.mail_filter) != '' OR EXISTS (
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

  function aliases(applicationId: string): ApplicationAlias[] {
    return selectAliases.all(applicationId) as ApplicationAlias[];
  }

  // One read for a sync: application id -> its other names; applications without any are absent.
  function aliasesForProfile(profileId: string): Map<string, ApplicationAlias[]> {
    const rows = selectProfileAliases.all(profileId) as (ApplicationAlias & { application_id: string })[];
    const byApp = new Map<string, ApplicationAlias[]>();
    for (const { application_id, company, role } of rows) {
      byApp.set(application_id, [...(byApp.get(application_id) ?? []), { company, role }]);
    }
    return byApp;
  }

  const insertAlias = db.prepare(
    `INSERT INTO application_aliases (id, application_id, company, role, created_at)
     VALUES (@id, @application_id, @company, @role, @created_at)`,
  );
  const updateMergedFields = db.prepare(
    `UPDATE applications SET url = @url, job_id = @job_id, applied_at = @applied_at,
       sender_domains = @sender_domains, notes = @notes WHERE id = @id`,
  );
  // Each statement moves one table's rows from a removed application to the kept one.
  const moveRows = [
    'UPDATE status_history SET application_id = @keep WHERE application_id = @from',
    'UPDATE proposals SET application_id = @keep WHERE application_id = @from',
    'UPDATE application_proposals SET application_id = @keep WHERE application_id = @from',
    'DELETE FROM application_aliases WHERE application_id = @from',
    'DELETE FROM applications WHERE id = @from',
  ].map((sql) => db.prepare(sql));
  const selectPendingProposals = db.prepare(
    "SELECT id, proposed_status FROM proposals WHERE application_id = ? AND state = 'pending'",
  );
  const rejectProposal = db.prepare("UPDATE proposals SET state = 'rejected', decided_at = ? WHERE id = ?");

  // Joins applications the user knows are one into the kept one (SOW-0055): its own details stay, gaps are
  // filled from the others, every row that pointed at them moves to it and their names become its aliases.
  function merge(keepId: string, mergeIds: string[]): Application {
    return db.transaction(() => {
      const kept = require(keepId);
      const removed = mergeIds.map(require);
      if (removed.some((a) => a.profile_id !== kept.profile_id)) {
        throw new Error('Applications belong to different profiles');
      }
      const now = new Date().toISOString();
      const fields = mergedFields(kept, removed);
      const names = aliasesToKeep(
        kept,
        aliases(keepId),
        removed.map((app) => ({ app, aliases: aliases(app.id) })),
      );
      updateMergedFields.run({ ...fields, sender_domains: JSON.stringify(fields.sender_domains), id: keepId });
      for (const name of names) {
        insertAlias.run({ id: randomUUID(), application_id: keepId, ...name, created_at: now });
      }
      for (const app of removed) for (const stmt of moveRows) stmt.run({ keep: keepId, from: app.id });
      // Decision 7B: accepting one of these would move the kept application backwards.
      const rows = selectPendingProposals.all(keepId) as { id: string; proposed_status: string }[];
      for (const row of rows) {
        if (stageOf(row.proposed_status) <= stageOf(kept.status)) rejectProposal.run(now, row.id);
      }
      return get(keepId) as Application;
    })();
  }

  return {
    create,
    get,
    findByJobId,
    list,
    profileIdsToSync,
    update,
    setStatus,
    history,
    historyForProfile,
    aliases,
    aliasesForProfile,
    merge,
  };
}
