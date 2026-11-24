import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { createJobsRepo } from '../../../src/server/db/jobs-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { createApplicationProposalsRepo } from '../../../src/server/db/application-proposals-repo.js';
import { createProposalsRepo } from '../../../src/server/db/proposals-repo.js';
import { summarizeDashboard } from '../../../src/server/domain/dashboard.js';
import {
  ATS_DOMAINS,
  createApplicationsRepo,
  inferSenderDomain,
} from '../../../src/server/db/applications-repo.js';
import { insertTestProfile } from './test-profile.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  return { db, pid: insertTestProfile(db), repo: createApplicationsRepo(db) };
}

describe('applications repo', () => {
  it('defaults to applied with applied_at set', () => {
    const { repo, pid } = setup();
    const app = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    expect(app.status).toBe('applied');
    expect(app.applied_at).not.toBeNull();
    expect(app.status_changed_at).toBe(app.created_at);
    expect(app.sender_domains).toEqual([]);
    expect(repo.get(app.id)).toEqual(app);
  });

  it('saved applications have no applied_at even if one is given', () => {
    const { repo, pid } = setup();
    const app = repo.create({ profile_id: pid,
      company: 'Acme',
      role: 'Engineer',
      status: 'saved',
      applied_at: '2026-01-01T00:00:00.000Z',
    });
    expect(app.status).toBe('saved');
    expect(app.applied_at).toBeNull();
  });

  it('honours explicit applied_at and null for non-applied statuses', () => {
    const { repo, pid } = setup();
    const a = repo.create({ profile_id: pid,
      company: 'A',
      role: 'R',
      applied_at: '2026-01-01T00:00:00.000Z',
    });
    expect(a.applied_at).toBe('2026-01-01T00:00:00.000Z');
    const b = repo.create({ profile_id: pid, company: 'B', role: 'R', status: 'interview' });
    expect(b.applied_at).toBeNull();
  });

  it('returns null for unknown ids and throws on update/setStatus', () => {
    const { repo } = setup();
    expect(repo.get('nope')).toBeNull();
    expect(() => repo.update('nope', { notes: 'x' })).toThrow('Application not found: nope');
    expect(() => repo.setStatus('nope', 'offer', 'user')).toThrow('Application not found: nope');
  });

  it('updates only provided keys and JSON-encodes sender_domains', () => {
    const { repo, pid } = setup();
    const app = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', notes: 'keep' });
    const updated = repo.update(app.id, { role: 'Staff', sender_domains: ['acme.com'] });
    expect(updated.role).toBe('Staff');
    expect(updated.company).toBe('Acme');
    expect(updated.notes).toBe('keep');
    expect(updated.sender_domains).toEqual(['acme.com']);
  });

  it('setStatus writes one history row and is a no-op for the same status', () => {
    const { repo, pid } = setup();
    const app = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
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
    const { db, repo, pid } = setup();
    const app = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const now = new Date().toISOString();
    const runId = 'run-1';
    db.prepare(
      "INSERT INTO runs (id, profile_id, kind, status, started_at, created_at) VALUES (?, ?, 'sync_mail', 'succeeded', ?, ?)",
    ).run(runId, pid, now, now);
    db.prepare(
      `INSERT INTO proposals (id, run_id, application_id, proposed_status, confidence, reason, created_at)
       VALUES ('p1', ?, ?, 'rejected', 0.9, 'r', ?)`,
    ).run(runId, app.id, now);
    repo.setStatus(app.id, 'rejected', 'proposal', 'p1');
    expect(repo.history(app.id)[0]).toMatchObject({ source: 'proposal', proposal_id: 'p1' });
  });

  it('list({ open: true }) filters by status and offer freshness', () => {
    const { db, repo, pid } = setup();
    const mk = (status: Parameters<typeof repo.create>[0]['status']) =>
      repo.create({ profile_id: pid, company: String(status), role: 'R', status });
    mk('saved');
    mk('rejected');
    mk('withdrawn');
    const stale = mk('offer');
    const fresh = mk('offer');
    mk('no_response');
    mk('applied');
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
    db.prepare('UPDATE applications SET status_changed_at = ? WHERE id = ?').run(old, stale.id);

    const open = repo.list(pid, { open: true });
    const statuses = open.map((a) => a.status).sort();
    expect(statuses).toEqual(['applied', 'no_response', 'offer']);
    expect(open.map((a) => a.id)).toContain(fresh.id);
    expect(open.map((a) => a.id)).not.toContain(stale.id);
    expect(repo.list(pid)).toHaveLength(7);
  });

  it('findByJobId returns the newest application for a job, or null', () => {
    const { db, repo, pid } = setup();
    const run = createRunsRepo(db).create('discover_jobs', pid, { adapter_id: '', prompt_version: null });
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
        fit_checks: null,
        match_reason: null,
        verification_status: 'ok',
        verified_at: null,
        dedupe_key: 'a|r',
      },
    ]);
    expect(repo.findByJobId(job.id)).toBeNull();
    repo.create({ profile_id: pid, company: 'A', role: 'R', job_id: job.id });
    const newer = repo.create({ profile_id: pid, company: 'A', role: 'R2', job_id: job.id });
    expect(repo.findByJobId(job.id)?.id).toBe(newer.id);
  });

  it('lists newest first', () => {
    const { repo, pid } = setup();
    const a = repo.create({ profile_id: pid, company: 'A', role: 'R' });
    const b = repo.create({ profile_id: pid, company: 'B', role: 'R' });
    expect(repo.list(pid).map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it("historyForProfile returns only that profile's rows, oldest first", () => {
    const { db, repo, pid } = setup();
    const other = insertTestProfile(db, 'Data roles');
    const mine = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'applied' });
    const theirs = repo.create({ profile_id: other, company: 'Globex', role: 'Engineer', status: 'applied' });
    for (const a of [mine, theirs]) {
      repo.setStatus(a.id, 'screening', 'user');
      repo.setStatus(a.id, 'interview', 'user');
    }
    const rows = repo.historyForProfile(pid);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.application_id === mine.id)).toBe(true);
    expect(rows.map((r) => r.to_status)).toEqual(['screening', 'interview']);
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
    expect(ATS_DOMAINS).toHaveLength(12);
  });
  it.each([
    'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1',
    'https://careers-acme.icims.com/jobs/1',
    'https://jobs.jobvite.com/acme/job/1',
    'https://acme.teamtailor.com/jobs/1',
  ])('returns null for the ATS host of %s (SOW-0045)', (url) => {
    expect(inferSenderDomain(url)).toBeNull();
  });

  it('profileIdsToSync lists profiles with an open application, by name', () => {
    const { db, repo, pid } = setup();
    const busy = insertTestProfile(db, 'A busy profile');
    const closed = insertTestProfile(db, 'Closed profile');
    insertTestProfile(db, 'Empty profile');
    repo.create({ profile_id: pid, company: 'Acme', role: 'R', status: 'interview' });
    repo.create({ profile_id: busy, company: 'Globex', role: 'R', status: 'applied' });
    repo.create({ profile_id: closed, company: 'Initech', role: 'R', status: 'rejected' });
    repo.create({ profile_id: closed, company: 'Hooli', role: 'R', status: 'saved' });
    const staleOffer = repo.create({ profile_id: closed, company: 'Umbrella', role: 'R', status: 'offer' });
    db.prepare('UPDATE applications SET status_changed_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', staleOffer.id);
    expect(repo.profileIdsToSync()).toEqual([busy, pid]);
  });

  it('profileIdsToSync also lists profiles with a Gmail scope and no open application (SOW-0045)', () => {
    const { db, repo, pid } = setup();
    const scoped = insertTestProfile(db, 'Scoped profile');
    const blank = insertTestProfile(db, 'Blank scope');
    db.prepare("UPDATE profiles SET mail_filter_kind = 'query', mail_filter = 'label:jobapplications' WHERE id = ?").run(scoped);
    db.prepare("UPDATE profiles SET mail_filter = '   ' WHERE id = ?").run(blank);
    repo.create({ profile_id: scoped, company: 'Acme', role: 'R', status: 'saved' });
    expect(repo.profileIdsToSync()).toEqual([scoped]);
    expect(repo.profileIdsToSync()).not.toContain(pid);
  });
});

describe('application aliases', () => {
  const addAlias = (db: ReturnType<typeof setup>['db'], applicationId: string, company: string, role: string) =>
    db
      .prepare('INSERT INTO application_aliases (id, application_id, company, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(`${applicationId}-${role}`, applicationId, company, role, '2026-11-01T00:00:00.000Z');

  it('aliases lists only that application\'s names, oldest first', () => {
    const { db, repo, pid } = setup();
    const a = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const b = repo.create({ profile_id: pid, company: 'Globex', role: 'SRE' });
    addAlias(db, a.id, 'Acme', 'Developer');
    addAlias(db, a.id, 'Acme Inc', 'Engineer II');
    addAlias(db, b.id, 'Globex', 'Ops');
    expect(repo.aliases(a.id)).toEqual([
      { company: 'Acme', role: 'Developer' },
      { company: 'Acme Inc', role: 'Engineer II' },
    ]);
    expect(repo.aliases('missing')).toEqual([]);
  });

  it('aliasesForProfile maps the profile\'s applications to their names and skips other profiles', () => {
    const { db, repo, pid } = setup();
    const other = insertTestProfile(db, 'Other profile');
    const a = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    repo.create({ profile_id: pid, company: 'Initech', role: 'Dev' });
    const theirs = repo.create({ profile_id: other, company: 'Globex', role: 'SRE' });
    addAlias(db, a.id, 'Acme', 'Developer');
    addAlias(db, theirs.id, 'Globex', 'Ops');
    expect([...repo.aliasesForProfile(pid)]).toEqual([[a.id, [{ company: 'Acme', role: 'Developer' }]]]);
  });
});

describe('merge', () => {
  const evidence = { message_id: 'msg-001', date: '2026-11-01', from: 'hr@acme.example', subject: 's', snippet: 'x' };

  function world() {
    const base = setup();
    const { db, pid } = base;
    const run = createRunsRepo(db).create('sync_mail', pid, { adapter_id: '', prompt_version: null });
    return {
      ...base,
      run,
      proposals: createProposalsRepo(db),
      appProposals: createApplicationProposalsRepo(db),
      count: (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n,
    };
  }

  const propose = (w: ReturnType<typeof world>, applicationId: string, status: 'screening' | 'interview' | 'offer') =>
    w.proposals.createMany(w.run.id, [
      { application_id: applicationId, proposed_status: status, confidence: 0.9, reason: 'invented', evidence },
    ])[0]!;

  it('keeps the kept application\'s own details and fills its gaps from the others', () => {
    const { repo, pid } = world();
    const kept = repo.create({ profile_id: pid, company: 'Acme', role: 'Senior Engineer', status: 'interview', sender_domains: ['acme.example'], notes: 'Panel next week' });
    const other = repo.create({
      profile_id: pid, company: 'Acme', role: 'Engineer (React)', url: 'https://acme.example/jobs/1',
      applied_at: '2026-10-30T00:00:00.000Z', sender_domains: ['jobs.acme.example'], notes: 'Applied via site',
    });
    const merged = repo.merge(kept.id, [other.id]);
    expect(merged).toEqual({
      ...kept,
      url: 'https://acme.example/jobs/1',
      applied_at: '2026-10-30T00:00:00.000Z',
      sender_domains: ['acme.example', 'jobs.acme.example'],
      notes: 'Panel next week\n\nApplied via site',
    });
    expect(repo.get(other.id)).toBeNull();
    expect(repo.list(pid).map((a) => a.id)).toEqual([kept.id]);
  });

  it('moves history, status proposals and new-application proposals to the kept application', () => {
    const w = world();
    const { repo, pid } = w;
    const kept = repo.create({ profile_id: pid, company: 'Acme', role: 'Senior Engineer', status: 'interview' });
    const other = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    repo.setStatus(other.id, 'screening', 'user');
    const accepted = propose(w, other.id, 'offer');
    w.proposals.decide(accepted.id, 'accepted');
    const [found] = w.appProposals.createMany(w.run.id, pid, [
      { company: 'Acme', role: 'Engineer', status: 'applied', applied_at: 't', job_id: null, url: null, sender_domains: [], confidence: 0.8, reason: 'r', evidence },
    ]);
    w.appProposals.decide(found!.id, 'accepted', other.id);

    repo.merge(kept.id, [other.id]);
    expect(repo.history(kept.id).map((h) => [h.from_status, h.to_status])).toEqual([['applied', 'screening']]);
    expect(w.proposals.get(accepted.id)!.application_id).toBe(kept.id);
    expect(w.appProposals.get(found!.id)!.application_id).toBe(kept.id);
    for (const table of ['status_history', 'proposals', 'application_proposals']) {
      expect(w.count(`SELECT COUNT(*) AS n FROM ${table} WHERE application_id = ?`, other.id), table).toBe(0);
    }
  });

  it('remembers every removed name as an alias of the kept application', () => {
    const w = world();
    const { repo, pid, db } = w;
    const kept = repo.create({ profile_id: pid, company: 'Acme', role: 'Senior Engineer' });
    const a = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer (React)' });
    const b = repo.create({ profile_id: pid, company: 'acme', role: 'senior engineer' });
    db.prepare("INSERT INTO application_aliases (id, application_id, company, role, created_at) VALUES ('al-1', ?, 'Acme', 'Frontend Dev', 't')").run(a.id);
    repo.merge(kept.id, [a.id, b.id]);
    expect(repo.aliases(kept.id)).toEqual([
      { company: 'Acme', role: 'Frontend Dev' },
      { company: 'Acme', role: 'Engineer (React)' },
    ]);
    expect(w.count('SELECT COUNT(*) AS n FROM application_aliases')).toBe(2);
  });

  it('rejects moved pending proposals that would not move the kept application forward', () => {
    const w = world();
    const { repo, pid } = w;
    const kept = repo.create({ profile_id: pid, company: 'Acme', role: 'Senior Engineer', status: 'interview' });
    const other = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const back = propose(w, other.id, 'screening');
    const same = propose(w, other.id, 'interview');
    const forward = propose(w, other.id, 'offer');
    repo.merge(kept.id, [other.id]);
    expect(w.proposals.get(back.id)).toMatchObject({ state: 'rejected', application_id: kept.id, decided_at: expect.any(String) });
    expect(w.proposals.get(same.id)!.state).toBe('rejected');
    expect(w.proposals.get(forward.id)).toMatchObject({ state: 'pending', decided_at: null });
  });

  it('rejects a moved offer for a rejected application but keeps it for a withdrawn one', () => {
    const w = world();
    const { repo, pid } = w;
    const rejected = repo.create({ profile_id: pid, company: 'Acme', role: 'A', status: 'rejected' });
    const withdrawn = repo.create({ profile_id: pid, company: 'Globex', role: 'B', status: 'withdrawn' });
    const one = repo.create({ profile_id: pid, company: 'Acme', role: 'A2' });
    const two = repo.create({ profile_id: pid, company: 'Globex', role: 'B2' });
    const p1 = propose(w, one.id, 'offer');
    const p2 = propose(w, two.id, 'offer');
    repo.merge(rejected.id, [one.id]);
    repo.merge(withdrawn.id, [two.id]);
    expect(w.proposals.get(p1.id)!.state).toBe('rejected');
    expect(w.proposals.get(p2.id)!.state).toBe('pending');
  });

  it('counts a merged application once on the Dashboard, with the stages its moved history reached', () => {
    const { repo, pid } = world();
    const kept = repo.create({ profile_id: pid, company: 'Acme', role: 'Senior Engineer', status: 'screening' });
    const other = repo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    repo.setStatus(other.id, 'interview', 'user');
    repo.merge(kept.id, [other.id]);
    const summary = summarizeDashboard(repo.list(pid), repo.historyForProfile(pid), 0, new Date());
    expect(summary.total).toBe(1);
    expect(summary.funnel.interview).toBe(1);
  });

  it('throws and changes nothing for an unknown id or another profile\'s application', () => {
    const { repo, pid, db } = world();
    const other = insertTestProfile(db, 'Other profile');
    const kept = repo.create({ profile_id: pid, company: 'Acme', role: 'A' });
    const mine = repo.create({ profile_id: pid, company: 'Acme', role: 'B' });
    const theirs = repo.create({ profile_id: other, company: 'Acme', role: 'C' });
    expect(() => repo.merge(kept.id, [mine.id, 'missing'])).toThrow('Application not found: missing');
    expect(() => repo.merge(kept.id, [mine.id, theirs.id])).toThrow('Applications belong to different profiles');
    expect(repo.get(mine.id)).not.toBeNull();
    expect(repo.get(theirs.id)).not.toBeNull();
    expect(repo.aliases(kept.id)).toEqual([]);
  });

  it('changes nothing when it fails part-way', () => {
    const w = world();
    const { repo, pid, db } = w;
    const kept = repo.create({ profile_id: pid, company: 'Acme', role: 'A', status: 'interview' });
    const other = repo.create({ profile_id: pid, company: 'Acme', role: 'B', url: 'https://acme.example/1' });
    repo.setStatus(other.id, 'screening', 'user');
    const pending = propose(w, other.id, 'screening');
    db.exec("CREATE TEMP TRIGGER stop BEFORE DELETE ON applications BEGIN SELECT RAISE(ABORT, 'stop'); END");
    expect(() => repo.merge(kept.id, [other.id])).toThrow('stop');
    expect(repo.get(kept.id)).toEqual(kept);
    expect(repo.get(other.id)!.status).toBe('screening');
    expect(repo.history(other.id)).toHaveLength(1);
    expect(w.proposals.get(pending.id)).toMatchObject({ application_id: other.id, state: 'pending' });
    expect(w.count('SELECT COUNT(*) AS n FROM application_aliases')).toBe(0);
  });
});
