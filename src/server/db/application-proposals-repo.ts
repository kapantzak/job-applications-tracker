import { randomUUID } from 'node:crypto';
import type { ApplicationProposal, ProposalEvidence, ProposalState } from '../domain/types.js';
import type { Db } from './connection.js';

export type NewApplicationProposal = Pick<
  ApplicationProposal,
  | 'company'
  | 'role'
  | 'status'
  | 'applied_at'
  | 'job_id'
  | 'url'
  | 'sender_domains'
  | 'confidence'
  | 'reason'
  | 'evidence'
>;

type Row = Omit<ApplicationProposal, 'evidence' | 'sender_domains'> & { evidence: string; sender_domains: string };

function fromRow(row: Row): ApplicationProposal {
  return {
    ...row,
    evidence: JSON.parse(row.evidence) as ProposalEvidence,
    sender_domains: JSON.parse(row.sender_domains) as string[],
  };
}

// Proposals for applications the app does not track yet (SOW-0045).
export function createApplicationProposalsRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO application_proposals (id, profile_id, run_id, company, role, status, applied_at, job_id, url,
       sender_domains, confidence, reason, evidence, state, application_id, decided_at, created_at)
     VALUES (@id, @profile_id, @run_id, @company, @role, @status, @applied_at, @job_id, @url,
       @sender_domains, @confidence, @reason, @evidence, 'pending', NULL, NULL, @created_at)`,
  );
  const selectById = db.prepare('SELECT * FROM application_proposals WHERE id = ?');
  // rowid tiebreak keeps same-millisecond inserts in insertion order.
  const selectPending = db.prepare(
    `SELECT * FROM application_proposals WHERE profile_id = ? AND state = 'pending'
     ORDER BY created_at ASC, rowid ASC`,
  );
  const updateState = db.prepare(
    'UPDATE application_proposals SET state = ?, application_id = ?, decided_at = ? WHERE id = ?',
  );
  // Pending ones too: the agent must not propose a message again while it waits for review.
  const selectMessageIds = db.prepare(
    `SELECT DISTINCT json_extract(evidence, '$.message_id') AS message_id
     FROM application_proposals WHERE profile_id = ?`,
  );

  // Every proposal, decided or not: a company and role proposed once is never proposed again (decision 12A).
  const selectNames = db.prepare(
    'SELECT company, role FROM application_proposals WHERE profile_id = ? ORDER BY created_at ASC, rowid ASC',
  );

  function get(id: string): ApplicationProposal | null {
    const row = selectById.get(id) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  function createMany(runId: string, profileId: string, items: NewApplicationProposal[]): ApplicationProposal[] {
    return db.transaction(() => {
      const now = new Date().toISOString();
      return items.map((item) => {
        const id = randomUUID();
        insert.run({
          ...item,
          id,
          profile_id: profileId,
          run_id: runId,
          sender_domains: JSON.stringify(item.sender_domains),
          evidence: JSON.stringify(item.evidence),
          created_at: now,
        });
        return get(id) as ApplicationProposal;
      });
    })();
  }

  function listPending(profileId: string): ApplicationProposal[] {
    return (selectPending.all(profileId) as Row[]).map(fromRow);
  }

  function decide(
    id: string,
    state: Exclude<ProposalState, 'pending'>,
    applicationId: string | null,
  ): ApplicationProposal {
    const result = updateState.run(state, applicationId, new Date().toISOString(), id);
    if (result.changes === 0) throw new Error(`Application proposal not found: ${id}`);
    return get(id) as ApplicationProposal;
  }

  function messageIds(profileId: string): string[] {
    return (selectMessageIds.all(profileId) as { message_id: string | null }[])
      .map((r) => r.message_id)
      .filter((m): m is string => m !== null && m.trim() !== '');
  }

  function names(profileId: string): { company: string; role: string }[] {
    return selectNames.all(profileId) as { company: string; role: string }[];
  }

  return { createMany, get, listPending, decide, messageIds, names };
}

export type ApplicationProposalsRepo = ReturnType<typeof createApplicationProposalsRepo>;
