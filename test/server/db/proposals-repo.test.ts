import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../../src/server/db/connection.js";
import { createApplicationsRepo } from "../../../src/server/db/applications-repo.js";
import { createProposalsRepo } from "../../../src/server/db/proposals-repo.js";
import { insertTestProfile } from "./test-profile.js";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const pid = insertTestProfile(db);
  const runId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO runs (id, profile_id, kind, status, started_at, created_at) VALUES (?, ?, 'sync_mail', 'succeeded', ?, ?)",
  ).run(runId, pid, now, now);
  const app = createApplicationsRepo(db).create({
    profile_id: pid,
    company: "Acme",
    role: "Engineer",
  });
  return { db, pid, runId, app, repo: createProposalsRepo(db) };
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
    const { repo, runId, app, pid } = setup();
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
    expect(repo.listPending(pid)).toEqual(created);
    expect(repo.get(created[0].id)?.evidence.message_id).toBe("msg-001");
    expect(repo.get("nope")).toBeNull();
  });

  it("decide removes from pending and exposes the message id as reviewed", () => {
    const { repo, runId, app, pid } = setup();
    const [p] = repo.createMany(runId, [
      {
        application_id: app.id,
        proposed_status: "interview",
        confidence: 0.9,
        reason: "a",
        evidence: evidence("msg-001"),
      },
    ]);
    expect(repo.reviewedMessageIds(pid)).toEqual([]);
    const decided = repo.decide(p.id, "rejected");
    expect(decided.state).toBe("rejected");
    expect(decided.decided_at).not.toBeNull();
    expect(repo.listPending(pid)).toEqual([]);
    expect(repo.reviewedMessageIds(pid)).toEqual(["msg-001"]);
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

  it("lists pending proposals and reviewed message ids per profile of the application", () => {
    const { db, repo, runId, app, pid } = setup();
    const other = insertTestProfile(db, "Other profile");
    const otherApp = createApplicationsRepo(db).create({ profile_id: other, company: "Initech", role: "SRE" });
    const [mine, theirs] = repo.createMany(runId, [
      { application_id: app.id, proposed_status: "interview", confidence: 0.9, reason: "a", evidence: evidence("msg-001") },
      { application_id: otherApp.id, proposed_status: "rejected", confidence: 0.9, reason: "b", evidence: evidence("msg-002") },
    ]);
    expect(repo.listPending(pid).map((p) => p.id)).toEqual([mine!.id]);
    expect(repo.listPending(other).map((p) => p.id)).toEqual([theirs!.id]);
    repo.decide(theirs!.id, "rejected");
    expect(repo.reviewedMessageIds(pid)).toEqual([]);
    expect(repo.reviewedMessageIds(other)).toEqual(["msg-002"]);
  });
});
