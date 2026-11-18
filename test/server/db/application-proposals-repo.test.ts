import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApplicationProposalsRepo, type NewApplicationProposal } from '../../../src/server/db/application-proposals-repo.js';
import { createApplicationsRepo } from '../../../src/server/db/applications-repo.js';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { insertTestProfile } from './test-profile.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const pid = insertTestProfile(db, 'Platform');
  const other = insertTestProfile(db, 'Backend');
  const run = (profileId: string) => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO runs (id, profile_id, kind, status, created_at) VALUES (?, ?, 'sync_mail', 'succeeded', ?)",
    ).run(id, profileId, new Date().toISOString());
    return id;
  };
  return { db, pid, other, runId: run(pid), otherRunId: run(other), repo: createApplicationProposalsRepo(db) };
}

const item = (company: string, messageId: string, overrides: Partial<NewApplicationProposal> = {}): NewApplicationProposal => ({
  company,
  role: 'Engineer',
  status: 'applied',
  applied_at: '2026-02-01T00:00:00.000Z',
  job_id: null,
  url: null,
  sender_domains: [],
  confidence: 0.8,
  reason: 'Application confirmation',
  evidence: {
    message_id: messageId,
    date: '2026-02-01',
    from: 'no-reply@ats.example.com',
    subject: 'Thanks for applying',
    snippet: 'We received your application.',
  },
  ...overrides,
});

describe('application proposals repo', () => {
  it('createMany stores every field and listPending returns the profile pending ones oldest first', () => {
    const { repo, pid, other, runId, otherRunId } = setup();
    const created = repo.createMany(runId, pid, [
      item('Acme', 'msg-001', { sender_domains: ['acme.example.com'], url: 'https://acme.example.com/jobs/1' }),
      item('Globex', 'msg-002', { status: 'interview' }),
    ]);
    repo.createMany(otherRunId, other, [item('Initech', 'msg-003')]);

    expect(created[0]).toMatchObject({
      profile_id: pid,
      run_id: runId,
      company: 'Acme',
      role: 'Engineer',
      status: 'applied',
      applied_at: '2026-02-01T00:00:00.000Z',
      job_id: null,
      url: 'https://acme.example.com/jobs/1',
      sender_domains: ['acme.example.com'],
      confidence: 0.8,
      state: 'pending',
      application_id: null,
      decided_at: null,
    });
    expect(created[0]?.evidence.message_id).toBe('msg-001');
    expect(repo.listPending(pid).map((p) => p.company)).toEqual(['Acme', 'Globex']);
    expect(repo.listPending(other).map((p) => p.company)).toEqual(['Initech']);
  });

  it('decide records the state, time and created application and drops it from the pending list', () => {
    const { db, repo, pid, runId } = setup();
    const [a, b] = repo.createMany(runId, pid, [item('Acme', 'msg-001'), item('Globex', 'msg-002')]);
    const app = createApplicationsRepo(db).create({ profile_id: pid, company: 'Acme', role: 'Engineer' });

    const accepted = repo.decide(a!.id, 'accepted', app.id);
    const rejected = repo.decide(b!.id, 'rejected', null);

    expect(accepted).toMatchObject({ state: 'accepted', application_id: app.id });
    expect(accepted.decided_at).toEqual(expect.any(String));
    expect(rejected).toMatchObject({ state: 'rejected', application_id: null });
    expect(repo.listPending(pid)).toEqual([]);
    expect(() => repo.decide('missing', 'rejected', null)).toThrow('Application proposal not found: missing');
  });

  it('messageIds lists pending and decided message ids of one profile only', () => {
    const { repo, pid, other, runId, otherRunId } = setup();
    const [a] = repo.createMany(runId, pid, [item('Acme', 'msg-001'), item('Globex', 'msg-002')]);
    repo.createMany(otherRunId, other, [item('Initech', 'msg-003')]);
    repo.decide(a!.id, 'rejected', null);

    expect(repo.messageIds(pid).sort()).toEqual(['msg-001', 'msg-002']);
    expect(repo.messageIds(other)).toEqual(['msg-003']);
    repo.createMany(otherRunId, other, [item('Hooli', ' ')]);
    expect(repo.messageIds(other)).toEqual(['msg-003']);
  });

  it('names lists the company and role of every proposal of one profile, in any state', () => {
    const { repo, pid, other, runId, otherRunId } = setup();
    const [a] = repo.createMany(runId, pid, [item('Acme', 'msg-001'), item('Globex', 'msg-002')]);
    repo.createMany(otherRunId, other, [item('Initech', 'msg-003')]);
    repo.decide(a!.id, 'rejected', null);
    expect(repo.names(pid)).toEqual([
      { company: 'Acme', role: 'Engineer' },
      { company: 'Globex', role: 'Engineer' },
    ]);
  });

  it('get returns null for an unknown id', () => {
    expect(setup().repo.get('missing')).toBeNull();
  });
});
