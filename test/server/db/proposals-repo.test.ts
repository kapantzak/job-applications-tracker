import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../../src/server/db/connection.js";
import { createApplicationsRepo } from "../../../src/server/db/applications-repo.js";
import { createProposalsRepo } from "../../../src/server/db/proposals-repo.js";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const runId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO runs (id, kind, status, started_at, created_at) VALUES (?, 'sync_mail', 'succeeded', ?, ?)",
  ).run(runId, now, now);
  const app = createApplicationsRepo(db).create({
    company: "Acme",
    role: "Engineer",
  });
  return { db, runId, app, repo: createProposalsRepo(db) };
}

const evidence = (id: string) => ({
  message_id: id,
  date: "2026-01-02T00:00:00.000Z",
  from: "recruiter@example.com",
  subject: "Interview invitation",
  snippet: "We would like to invite you",
});

describe("proposals repo", () => {
  it("createMany then listPending returns them oldest first", () => {
    const { repo, runId, app } = setup();
    const created = repo.createMany(runId, [
      {
        application_id: app.id,
        proposed_status: "interview",
        confidence: 0.9,
        reason: "a",
        evidence: evidence("msg-001"),
      },
      {
        application_id: app.id,
        proposed_status: "rejected",
        confidence: 0.5,
        reason: "b",
        evidence: evidence("msg-002"),
      },
    ]);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      state: "pending",
      decided_at: null,
      run_id: runId,
    });
    expect(repo.listPending()).toEqual(created);
    expect(repo.get(created[0].id)?.evidence.message_id).toBe("msg-001");
    expect(repo.get("nope")).toBeNull();
  });

  it("decide removes from pending and exposes the message id as reviewed", () => {
    const { repo, runId, app } = setup();
    const [p] = repo.createMany(runId, [
      {
        application_id: app.id,
        proposed_status: "interview",
        confidence: 0.9,
        reason: "a",
        evidence: evidence("msg-001"),
      },
    ]);
    expect(repo.reviewedMessageIds()).toEqual([]);
    const decided = repo.decide(p.id, "rejected");
    expect(decided.state).toBe("rejected");
    expect(decided.decided_at).not.toBeNull();
    expect(repo.listPending()).toEqual([]);
    expect(repo.reviewedMessageIds()).toEqual(["msg-001"]);
  });

  it("decide throws for an unknown id", () => {
    const { repo } = setup();
    expect(() => repo.decide("missing", "accepted")).toThrow(
      "Proposal not found: missing",
    );
  });

  it("hasPending reflects pending proposals only", () => {
    const { repo, runId, app } = setup();
    const [p] = repo.createMany(runId, [
      {
        application_id: app.id,
        proposed_status: "interview",
        confidence: 0.9,
        reason: "a",
        evidence: evidence("msg-001"),
      },
    ]);
    expect(repo.hasPending(app.id, "interview")).toBe(true);
    expect(repo.hasPending(app.id, "offer")).toBe(false);
    repo.decide(p.id, "accepted");
    expect(repo.hasPending(app.id, "interview")).toBe(false);
  });
});
