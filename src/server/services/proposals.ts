import type { Db } from "../db/connection.js";
import type { createApplicationsRepo } from "../db/applications-repo.js";
import type { createProposalsRepo } from "../db/proposals-repo.js";
import type { Application, Proposal } from "../domain/types.js";

export class ProposalNotPendingError extends Error {
  constructor(id: string) {
    super(`Proposal is not pending: ${id}`);
    this.name = "ProposalNotPendingError";
  }
}

export interface ProposalServiceDeps {
  db: Db;
  proposalsRepo: ReturnType<typeof createProposalsRepo>;
  applicationsRepo: ReturnType<typeof createApplicationsRepo>;
}

export function createProposalService({
  db,
  proposalsRepo,
  applicationsRepo,
}: ProposalServiceDeps) {
  function requirePending(id: string): Proposal {
    const proposal = proposalsRepo.get(id);
    if (!proposal) throw new Error(`Proposal not found: ${id}`);
    if (proposal.state !== "pending") throw new ProposalNotPendingError(id);
    return proposal;
  }

  // Transaction keeps the status change and the decision atomic.
  const accept = db.transaction(
    (id: string): { proposal: Proposal; application: Application } => {
      const proposal = requirePending(id);
      const current = applicationsRepo.get(proposal.application_id);
      if (!current)
        throw new Error(`Application not found: ${proposal.application_id}`);
      // Already at the proposed status: record the decision without a no-op history row.
      const application =
        current.status === proposal.proposed_status
          ? current
          : applicationsRepo.setStatus(
              current.id,
              proposal.proposed_status,
              "proposal",
              id,
            );
      return { proposal: proposalsRepo.decide(id, "accepted"), application };
    },
  );

  function reject(id: string): Proposal {
    requirePending(id);
    return proposalsRepo.decide(id, "rejected");
  }

  return { accept: (id: string) => accept(id), reject };
}
