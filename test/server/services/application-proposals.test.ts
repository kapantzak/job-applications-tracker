import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApplicationProposalsRepo, type NewApplicationProposal } from '../../../src/server/db/application-proposals-repo.js';
import { createApplicationsRepo } from '../../../src/server/db/applications-repo.js';
import { migrate, openDatabase } from '../../../src/server/db/connection.js';
import { createJobsRepo } from '../../../src/server/db/jobs-repo.js';
import { createApplicationProposalService } from '../../../src/server/services/application-proposals.js';
import { ProposalNotPendingError } from '../../../src/server/services/proposals.js';
import { sampleJob } from '../api/harness.js';
import { insertTestProfile } from '../db/test-profile.js';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const pid = insertTestProfile(db, 'Platform');
  const runId = randomUUID();
  db.prepare("INSERT INTO runs (id, profile_id, kind, status, created_at) VALUES (?, ?, 'sync_mail', 'succeeded', 't')").run(
    runId,
    pid,
  );
  const applicationsRepo = createApplicationsRepo(db);
  const repo = createApplicationProposalsRepo(db);
  const jobsRepo = createJobsRepo(db);
  const service = createApplicationProposalService({ db, applicationProposalsRepo: repo, applicationsRepo });
  return { db, pid, runId, applicationsRepo, repo, jobsRepo, service };
}

const item = (company: string, overrides: Partial<NewApplicationProposal> = {}): NewApplicationProposal => ({
  company,
  role: 'Engineer',
  status: 'interview',
  applied_at: '2026-02-01T00:00:00.000Z',
  job_id: null,
  url: null,
  sender_domains: ['acme.example.com'],
  confidence: 0.8,
  reason: 'Interview invitation',
  evidence: { message_id: `msg-${company}`, date: '2026-02-09', from: 'hr@acme.example.com', subject: 's', snippet: 'n' },
  ...overrides,
});

describe('application proposal service', () => {
  it('accept treats an application whose alias matches as already tracked (SOW-0055)', () => {
    const { pid, runId, repo, applicationsRepo, service } = setup();
    const kept = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Senior Engineer', status: 'interview' });
    const other = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer (React)' });
    applicationsRepo.merge(kept.id, [other.id]);
    const [p] = repo.createMany(runId, pid, [item('ACME', { role: 'engineer  (react)' })]);

    const { proposal, application, outcome } = service.accept(p!.id);

    expect(outcome).toBe('already_tracked');
    expect(application.id).toBe(kept.id);
    expect(proposal).toMatchObject({ state: 'accepted', application_id: kept.id });
    expect(applicationsRepo.list(pid)).toHaveLength(1);
  });

  it('accept prefers the application whose own name matches over an alias of a newer one (SOW-0055)', () => {
    const { pid, runId, repo, applicationsRepo, service } = setup();
    const own = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Dev', status: 'interview' });
    const kept = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Senior Engineer', status: 'interview' });
    const other = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Dev' });
    applicationsRepo.merge(kept.id, [other.id]);
    const [p] = repo.createMany(runId, pid, [item('Acme', { role: 'Dev' })]);
    expect(service.accept(p!.id).application.id).toBe(own.id);
  });

  it('accept creates the application with the proposed fields and no history row', () => {
    const { pid, runId, repo, applicationsRepo, service } = setup();
    const [p] = repo.createMany(runId, pid, [item('Acme', { url: 'https://acme.example.com/jobs/1' })]);

    const { proposal, application, outcome } = service.accept(p!.id);

    expect(outcome).toBe('created');
    expect(application).toMatchObject({
      profile_id: pid,
      company: 'Acme',
      role: 'Engineer',
      status: 'interview',
      applied_at: '2026-02-01T00:00:00.000Z',
      url: 'https://acme.example.com/jobs/1',
      sender_domains: ['acme.example.com'],
      job_id: null,
    });
    expect(proposal).toMatchObject({ state: 'accepted', application_id: application.id });
    expect(applicationsRepo.history(application.id)).toEqual([]);
  });

  it('accept dates the last change from the latest email, not the accept time (decision 16A)', () => {
    const { pid, runId, repo, service } = setup();
    const [p] = repo.createMany(runId, pid, [item('Acme')]);
    // The evidence date is the day 2026-02-09, stored as local midnight.
    expect(service.accept(p!.id).application.status_changed_at).toBe(new Date(2026, 1, 9).toISOString());
  });

  it('accept adds nothing when the company and role are tracked by now, and links the proposal (decision 11C)', () => {
    const { pid, runId, repo, applicationsRepo, service } = setup();
    const [p] = repo.createMany(runId, pid, [item('Acme')]);
    const mine = applicationsRepo.create({ profile_id: pid, company: 'ACME', role: 'engineer', status: 'applied' });

    const { proposal, application, outcome } = service.accept(p!.id);
    expect(outcome).toBe('already_tracked');
    expect(application.id).toBe(mine.id);
    expect(application.status).toBe('applied');
    expect(proposal).toMatchObject({ state: 'accepted', application_id: mine.id });
    expect(applicationsRepo.list(pid)).toHaveLength(1);
  });

  it('accept moves a saved application on with the mail date instead of adding one (decision 11C)', () => {
    const { pid, runId, repo, applicationsRepo, service } = setup();
    const [p] = repo.createMany(runId, pid, [item('Acme')]);
    const saved = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'saved' });

    const { application, outcome } = service.accept(p!.id);
    expect(outcome).toBe('moved');
    expect(application).toMatchObject({ id: saved.id, status: 'interview', applied_at: '2026-02-01T00:00:00.000Z' });
    expect(applicationsRepo.history(saved.id)).toMatchObject([{ from_status: 'saved', to_status: 'interview', source: 'proposal', proposal_id: null }]);
    expect(applicationsRepo.list(pid)).toHaveLength(1);
  });

  it("accept links the job, or uses the job's application when it got one meanwhile", () => {
    const { db, pid, runId, repo, jobsRepo, applicationsRepo, service } = setup();
    const discovery = randomUUID();
    db.prepare(
      "INSERT INTO runs (id, profile_id, kind, status, created_at) VALUES (?, ?, 'discover_jobs', 'succeeded', 't')",
    ).run(discovery, pid);
    const [free, taken] = jobsRepo.insertMany(discovery, [
      sampleJob({ company: 'Acme', title: 'Engineer', dedupe_key: 'acme|engineer' }),
      sampleJob({ company: 'Globex', title: 'Engineer', dedupe_key: 'globex|engineer' }),
    ]);
    const [a, b] = repo.createMany(runId, pid, [
      item('Acme', { job_id: free!.id }),
      item('Globex', { job_id: taken!.id }),
    ]);
    applicationsRepo.create({ profile_id: pid, job_id: taken!.id, company: 'Globex', role: 'Engineer', status: 'saved' });

    expect(service.accept(a!.id).application.job_id).toBe(free!.id);
    const viaJob = service.accept(b!.id);
    expect(viaJob).toMatchObject({ outcome: 'moved', application: { job_id: taken!.id, status: 'interview' } });
    expect(applicationsRepo.list(pid)).toHaveLength(2);
  });

  it('reject records the decision and creates nothing', () => {
    const { pid, runId, repo, applicationsRepo, service } = setup();
    const [p] = repo.createMany(runId, pid, [item('Acme')]);
    expect(service.reject(p!.id)).toMatchObject({ state: 'rejected', application_id: null });
    expect(applicationsRepo.list(pid)).toEqual([]);
  });

  it('accept and reject refuse a decided proposal, and an unknown one is not found', () => {
    const { pid, runId, repo, service } = setup();
    const [p] = repo.createMany(runId, pid, [item('Acme')]);
    service.reject(p!.id);
    expect(() => service.accept(p!.id)).toThrow(ProposalNotPendingError);
    expect(() => service.reject(p!.id)).toThrow(ProposalNotPendingError);
    expect(() => service.accept('missing')).toThrow('Application proposal not found: missing');
  });

  it('acceptMany accepts only the given pending proposals and skips decided ones (decision 15A)', () => {
    const { db, pid, runId, repo, applicationsRepo, service } = setup();
    const other = insertTestProfile(db, 'Backend');
    const otherRun = randomUUID();
    db.prepare("INSERT INTO runs (id, profile_id, kind, status, created_at) VALUES (?, ?, 'sync_mail', 'succeeded', 't')").run(
      otherRun,
      other,
    );
    const [first, second, third, late] = repo.createMany(runId, pid, [item('Acme'), item('Globex'), item('Initech'), item('Late')]);
    service.reject(first!.id);
    repo.createMany(otherRun, other, [item('Hooli')]);

    // The page showed the first three; "Late" arrived after it loaded.
    applicationsRepo.create({ profile_id: pid, company: 'Initech', role: 'Engineer', status: 'saved' });
    expect(service.acceptMany([first!.id, second!.id, third!.id])).toEqual({
      accepted: 2,
      created: 1,
      moved: 1,
      already_tracked: 0,
    });
    expect(applicationsRepo.list(pid).map((a) => a.company).sort()).toEqual(['Globex', 'Initech']);
    expect(repo.listPending(pid).map((p) => p.id)).toEqual([late!.id]);
    expect(repo.listPending(other)).toHaveLength(1);
  });
});
