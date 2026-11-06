import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { createJobsRepo } from '../../../src/server/db/jobs-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import {
  ATS_DOMAINS,
  createApplicationsRepo,
  inferSenderDomain,
} from '../../../src/server/db/applications-repo.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  return { db, repo: createApplicationsRepo(db) };
}

describe('applications repo', () => {
  it('defaults to applied with applied_at set', () => {
    const { repo } = setup();
    const app = repo.create({ company: 'Acme', role: 'Engineer' });
    expect(app.status).toBe('applied');
    expect(app.applied_at).not.toBeNull();
    expect(app.status_changed_at).toBe(app.created_at);
    expect(app.sender_domains).toEqual([]);
    expect(repo.get(app.id)).toEqual(app);
  });

  it('saved applications have no applied_at even if one is given', () => {
    const { repo } = setup();
    const app = repo.create({
      company: 'Acme',
      role: 'Engineer',
      status: 'saved',
      applied_at: '2026-01-01T00:00:00.000Z',
    });
    expect(app.status).toBe('saved');
    expect(app.applied_at).toBeNull();
  });

  it('honours explicit applied_at and null for non-applied statuses', () => {
    const { repo } = setup();
    const a = repo.create({
      company: 'A',
      role: 'R',
      applied_at: '2026-01-01T00:00:00.000Z',
    });
    expect(a.applied_at).toBe('2026-01-01T00:00:00.000Z');
    const b = repo.create({ company: 'B', role: 'R', status: 'interview' });
    expect(b.applied_at).toBeNull();
  });

  it('returns null for unknown ids and throws on update/setStatus', () => {
    const { repo } = setup();
    expect(repo.get('nope')).toBeNull();
    expect(() => repo.update('nope', { notes: 'x' })).toThrow('Application not found: nope');
    expect(() => repo.setStatus('nope', 'offer', 'user')).toThrow('Application not found: nope');
  });

  it('updates only provided keys and JSON-encodes sender_domains', () => {
    const { repo } = setup();
    const app = repo.create({ company: 'Acme', role: 'Engineer', notes: 'keep' });
    const updated = repo.update(app.id, { role: 'Staff', sender_domains: ['acme.com'] });
    expect(updated.role).toBe('Staff');
    expect(updated.company).toBe('Acme');
    expect(updated.notes).toBe('keep');
    expect(updated.sender_domains).toEqual(['acme.com']);
  });

  it('setStatus writes one history row and is a no-op for the same status', () => {
    const { repo } = setup();
    const app = repo.create({ company: 'Acme', role: 'Engineer' });
    const moved = repo.setStatus(app.id, 'screening', 'user');
    expect(moved.status).toBe('screening');
    const again = repo.setStatus(app.id, 'screening', 'user');
    expect(again).toEqual(moved);
    const history = repo.history(app.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      application_id: app.id,
      from_status: 'applied',
      to_status: 'screening',
      source: 'user',
      proposal_id: null,
    });
  });

  it('records proposal ids in history', () => {
    const { db, repo } = setup();
    const app = repo.create({ company: 'Acme', role: 'Engineer' });
    const now = new Date().toISOString();
    const runId = 'run-1';
    db.prepare(
      "INSERT INTO runs (id, kind, status, started_at, created_at) VALUES (?, 'sync_mail', 'succeeded', ?, ?)",
    ).run(runId, now, now);
    db.prepare(
      `INSERT INTO proposals (id, run_id, application_id, proposed_status, confidence, reason, created_at)
       VALUES ('p1', ?, ?, 'rejected', 0.9, 'r', ?)`,
    ).run(runId, app.id, now);
    repo.setStatus(app.id, 'rejected', 'proposal', 'p1');
    expect(repo.history(app.id)[0]).toMatchObject({ source: 'proposal', proposal_id: 'p1' });
  });

  it('list({ open: true }) filters by status and offer freshness', () => {
    const { db, repo } = setup();
    const mk = (status: Parameters<typeof repo.create>[0]['status']) =>
      repo.create({ company: String(status), role: 'R', status });
    mk('saved');
    mk('rejected');
    mk('withdrawn');
    const stale = mk('offer');
    const fresh = mk('offer');
    mk('no_response');
    mk('applied');
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
    db.prepare('UPDATE applications SET status_changed_at = ? WHERE id = ?').run(old, stale.id);

    const open = repo.list({ open: true });
    const statuses = open.map((a) => a.status).sort();
    expect(statuses).toEqual(['applied', 'no_response', 'offer']);
    expect(open.map((a) => a.id)).toContain(fresh.id);
    expect(open.map((a) => a.id)).not.toContain(stale.id);
    expect(repo.list()).toHaveLength(7);
  });

  it('findByJobId returns the newest application for a job, or null', () => {
    const { db, repo } = setup();
    const run = createRunsRepo(db).create('discover_jobs', { adapter_id: '', prompt_version: null });
    const [job] = createJobsRepo(db).insertMany(run.id, [
      {
        company: 'A',
        title: 'R',
        location: null,
        remote: 'remote',
        url: 'https://a.example/jobs/1',
        canonical_url: 'https://a.example/jobs/1',
        source_site: null,
        posted_at: null,
        salary: null,
        description_excerpt: null,
        match_reason: null,
        verification_status: 'ok',
        verified_at: null,
        dedupe_key: 'a|r',
      },
    ]);
    expect(repo.findByJobId(job.id)).toBeNull();
    repo.create({ company: 'A', role: 'R', job_id: job.id });
    const newer = repo.create({ company: 'A', role: 'R2', job_id: job.id });
    expect(repo.findByJobId(job.id)?.id).toBe(newer.id);
  });

  it('lists newest first', () => {
    const { repo } = setup();
    const a = repo.create({ company: 'A', role: 'R' });
    const b = repo.create({ company: 'B', role: 'R' });
    expect(repo.list().map((x) => x.id)).toEqual([b.id, a.id]);
  });
});

describe('inferSenderDomain', () => {
  it('strips www', () => {
    expect(inferSenderDomain('https://www.acme.com/careers/1')).toBe('acme.com');
  });
  it('returns null for ATS hosts and subdomains', () => {
    expect(inferSenderDomain('https://boards.greenhouse.io/acme/jobs/1')).toBeNull();
    expect(inferSenderDomain('https://lever.co/acme')).toBeNull();
  });
  it('does not treat lookalike domains as ATS', () => {
    expect(inferSenderDomain('https://notlever.co/x')).toBe('notlever.co');
  });
  it('returns null for invalid urls', () => {
    expect(inferSenderDomain('not a url')).toBeNull();
  });
  it('exports the ATS list', () => {
    expect(ATS_DOMAINS).toHaveLength(8);
  });
});
