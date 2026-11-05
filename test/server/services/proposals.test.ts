import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../../src/server/db/connection.js";
import { createApplicationsRepo } from "../../../src/server/db/applications-repo.js";
import { createProposalsRepo } from "../../../src/server/db/proposals-repo.js";
import {
  ProposalNotPendingError,
  createProposalService,
} from "../../../src/server/services/proposals.js";
import type { ApplicationStatus } from "../../../src/server/domain/types.js";

function setup(
  appStatus: ApplicationStatus = "applied",
  proposed: ApplicationStatus = "interview",
) {
  const db = openDatabase(":memory:");
  migrate(db);
  const runId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO runs (id, kind, status, started_at, created_at) VALUES (?, 'sync_mail', 'succeeded', ?, ?)",
  ).run(runId, now, now);
  const applicationsRepo = createApplicationsRepo(db);
  const proposalsRepo = createProposalsRepo(db);
  const app = applicationsRepo.create({
    company: "Acme",
    role: "Engineer",
    status: appStatus,
  });
  const [proposal] = proposalsRepo.createMany(runId, [
    {
      application_id: app.id,
      proposed_status: proposed,
      confidence: 0.9,
      reason: "invite",
      evidence: {
        message_id: "msg-001",
        date: "2026-01-02T00:00:00.000Z",
        from: "recruiter@example.com",
        subject: "Interview",
        snippet: "Invitation",
      },
    },
  ]);
  const service = createProposalService({
    db,
    proposalsRepo,
    applicationsRepo,
  });
  return { app, proposal, applicationsRepo, proposalsRepo, service };
}

describe("proposal service", () => {
  it("accept moves the application and records proposal history", () => {
    const { app, proposal, applicationsRepo, service } = setup();
    const result = service.accept(proposal.id);
    expect(result.proposal.state).toBe("accepted");
    expect(result.application.status).toBe("interview");
    const history = applicationsRepo.history(app.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      source: "proposal",
      proposal_id: proposal.id,
    });
  });

  it("accept with an unchanged status writes no history", () => {
    const { app, proposal, applicationsRepo, service } = setup(
      "interview",
      "interview",
    );
    const result = service.accept(proposal.id);
    expect(result.proposal.state).toBe("accepted");
    expect(applicationsRepo.history(app.id)).toHaveLength(0);
  });

  it("accepting twice throws ProposalNotPendingError", () => {
    const { proposal, service } = setup();
    service.accept(proposal.id);
    expect(() => service.accept(proposal.id)).toThrow(ProposalNotPendingError);
    expect(() => service.reject(proposal.id)).toThrow(
      `Proposal is not pending: ${proposal.id}`,
    );
  });

  it("reject leaves the application untouched", () => {
    const { app, proposal, applicationsRepo, service } = setup();
    expect(service.reject(proposal.id).state).toBe("rejected");
    expect(applicationsRepo.get(app.id)?.status).toBe("applied");
    expect(applicationsRepo.history(app.id)).toHaveLength(0);
  });
});
