import { randomUUID } from "node:crypto";
import type {
  ApplicationStatus,
  Proposal,
  ProposalEvidence,
  ProposalState,
} from "../domain/types.js";
import type { Db } from "./connection.js";

export type NewProposal = {
  application_id: string;
  proposed_status: ApplicationStatus;
  confidence: number;
  reason: string;
  evidence: ProposalEvidence;
};

type ProposalRow = Omit<Proposal, "evidence"> & { evidence: string };

function toProposal(row: ProposalRow): Proposal {
  return { ...row, evidence: JSON.parse(row.evidence) as ProposalEvidence };
}

export function createProposalsRepo(db: Db) {
  const insert = db.prepare(
    `INSERT INTO proposals (id, run_id, application_id, proposed_status, confidence, reason,
       evidence, state, decided_at, created_at)
     VALUES (@id, @run_id, @application_id, @proposed_status, @confidence, @reason,
       @evidence, 'pending', NULL, @created_at)`,
  );
  const selectById = db.prepare("SELECT * FROM proposals WHERE id = ?");
  // rowid tiebreak keeps same-millisecond inserts in insertion order.
  // Proposals belong to the profile of their application.
  const selectPending = db.prepare(
    `SELECT p.* FROM proposals p JOIN applications a ON a.id = p.application_id
     WHERE p.state = 'pending' AND a.profile_id = ?
     ORDER BY p.created_at ASC, p.rowid ASC`,
  );
  const updateState = db.prepare(
    "UPDATE proposals SET state = ?, decided_at = ? WHERE id = ?",
  );
  const selectReviewed = db.prepare(
    `SELECT DISTINCT json_extract(p.evidence, '$.message_id') AS message_id
     FROM proposals p JOIN applications a ON a.id = p.application_id
     WHERE p.state != 'pending' AND a.profile_id = ?`,
  );
  const selectHasPending = db.prepare(
    `SELECT 1 FROM proposals
     WHERE application_id = ? AND proposed_status = ? AND state = 'pending' LIMIT 1`,
  );

  function get(id: string): Proposal | null {
    const row = selectById.get(id) as ProposalRow | undefined;
    return row ? toProposal(row) : null;
  }

  function createMany(runId: string, items: NewProposal[]): Proposal[] {
    return db.transaction(() => {
      const now = new Date().toISOString();
      return items.map((item) => {
        const id = randomUUID();
        insert.run({
          id,
          run_id: runId,
          application_id: item.application_id,
          proposed_status: item.proposed_status,
          confidence: item.confidence,
          reason: item.reason,
          evidence: JSON.stringify(item.evidence),
          created_at: now,
        });
        return get(id) as Proposal;
      });
    })();
  }

  function listPending(profileId: string): Proposal[] {
    return (selectPending.all(profileId) as ProposalRow[]).map(toProposal);
  }

  function decide(
    id: string,
    state: Exclude<ProposalState, "pending">,
  ): Proposal {
    const result = updateState.run(state, new Date().toISOString(), id);
    if (result.changes === 0) throw new Error(`Proposal not found: ${id}`);
    return get(id) as Proposal;
  }

  // Per profile: a message reviewed for one profile may still matter to another.
  function reviewedMessageIds(profileId: string): string[] {
    return (selectReviewed.all(profileId) as { message_id: string | null }[])
      .map((r) => r.message_id)
      .filter((m): m is string => m !== null);
  }

  function hasPending(
    applicationId: string,
    proposedStatus: ApplicationStatus,
  ): boolean {
    return selectHasPending.get(applicationId, proposedStatus) !== undefined;
  }

  return {
    createMany,
    listPending,
    get,
    decide,
    reviewedMessageIds,
    hasPending,
  };
}
