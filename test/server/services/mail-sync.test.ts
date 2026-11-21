import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createApplicationProposalsRepo } from '../../../src/server/db/application-proposals-repo.js';
import { createApplicationsRepo } from '../../../src/server/db/applications-repo.js';
import { createJobsRepo } from '../../../src/server/db/jobs-repo.js';
import { createMailThreadsRepo, type MailThreadsRepo } from '../../../src/server/db/mail-threads-repo.js';
import { createProfilesRepo } from '../../../src/server/db/profiles-repo.js';
import { createProposalsRepo } from '../../../src/server/db/proposals-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { createSettingsRepo } from '../../../src/server/db/settings-repo.js';
import { MailAccessError, type MailSource, type MailSyncFindings, type ThreadSyncResult } from '../../../src/server/mail/types.js';
import type { RunContext } from '../../../src/server/runs/queue.js';
import { createMailSyncHandler } from '../../../src/server/services/mail-sync.js';
import { sampleJob } from '../api/harness.js';
import { insertTestProfile } from '../db/test-profile.js';

let db: Db;
let applicationsRepo: ReturnType<typeof createApplicationsRepo>;
let applicationProposalsRepo: ReturnType<typeof createApplicationProposalsRepo>;
let jobsRepo: ReturnType<typeof createJobsRepo>;
let proposalsRepo: ReturnType<typeof createProposalsRepo>;
let settingsRepo: ReturnType<typeof createSettingsRepo>;
let runsRepo: ReturnType<typeof createRunsRepo>;
let mailThreadsRepo: MailThreadsRepo;
let pid: string;
let logs: string[];
let factoryCalls: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  applicationsRepo = createApplicationsRepo(db);
  applicationProposalsRepo = createApplicationProposalsRepo(db);
  jobsRepo = createJobsRepo(db);
  proposalsRepo = createProposalsRepo(db);
  settingsRepo = createSettingsRepo(db);
  runsRepo = createRunsRepo(db);
  mailThreadsRepo = createMailThreadsRepo(db);
  pid = insertTestProfile(db);
  logs = [];
  factoryCalls = 0;
});

function finding(applicationId: string, status: string, msg = 'msg-001') {
  return {
    application_id: applicationId,
    proposed_status: status,
    confidence: 0.9,
    reason: 'Invitation received',
    evidence: { message_id: msg, date: '2026-02-01', from: 'hr@example.com', subject: 'Interview', snippet: 'Please pick a slot' },
  };
}

function handlerFor(source: Partial<MailSource> & { sync: MailSource['sync'] }) {
  return createMailSyncHandler({
    db,
    applicationsRepo,
    applicationProposalsRepo,
    jobsRepo,
    mailThreadsRepo,
    profilesRepo: createProfilesRepo(db),
    proposalsRepo,
    settingsRepo,
    mailSourceFactory: () => {
      factoryCalls++;
      return { id: 'agent', ...source };
    },
  });
}

function returning(findings: unknown[]) {
  return handlerFor({ sync: async () => ({ mail_access: true, findings, new_applications: [], notes: '', scope_message_count: null }) as MailSyncFindings });
}

function ctx(profileId = pid): RunContext {
  const run = runsRepo.create('sync_mail', profileId, { adapter_id: 'custom', prompt_version: null });
  return {
    run,
    log: (l) => logs.push(l),
    signal: new AbortController().signal,
    runDir: mkdtempSync(join(tmpdir(), 'mail-sync-')),
    recordAgent: (record) => runsRepo.update(run.id, record),
    recordUsage: (record) => runsRepo.update(run.id, record),
    beginSaving: () => {},
  };
}

describe('mail sync handler', () => {
  it('enters the saving phase after the mail source returns and saves nothing when refused', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const events: string[] = [];
    const handler = handlerFor({
      sync: async () => {
        events.push('agent');
        return { mail_access: true, findings: [finding(app.id, 'interview')], new_applications: [], notes: '', scope_message_count: null } as MailSyncFindings;
      },
    });
    const refusing = {
      ...ctx(),
      beginSaving: () => {
        events.push('saving');
        throw new Error('Aborted');
      },
    };
    await expect(handler(refusing)).rejects.toThrow('Aborted');
    expect(events).toEqual(['agent', 'saving']);
    expect(proposalsRepo.listPending(pid)).toHaveLength(0);
  });

  it('passes the run record callback to the mail source', async () => {
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const c = ctx();
    const handler = handlerFor({
      sync: async (_req, sctx) => {
        sctx.recordAgent({ adapter_id: 'claude', agent_model: 'sonnet', agent_effort: 'low' });
        return { mail_access: true, findings: [], new_applications: [], notes: '', scope_message_count: null } as MailSyncFindings;
      },
    });
    await handler(c);
    expect(runsRepo.get(c.run.id)).toMatchObject({ adapter_id: 'claude', agent_model: 'sonnet', agent_effort: 'low' });
  });

  it('creates a pending proposal with evidence', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const res = await returning([finding(app.id, 'interview')])(ctx());
    expect(res.summary).toBe('1 proposals created, 0 new applications found, 0 skipped');
    const [p] = proposalsRepo.listPending(pid);
    expect(p?.application_id).toBe(app.id);
    expect(p?.proposed_status).toBe('interview');
    expect(p?.evidence.message_id).toBe('msg-001');
    expect(logs).toContain(res.summary);
  });

  it('drops findings for unknown applications', async () => {
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const res = await returning([finding('nope', 'interview')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 0 skipped');
    expect(proposalsRepo.listPending(pid)).toHaveLength(0);
    expect(logs.some((l) => l.includes('unknown application'))).toBe(true);
  });

  it('ignores no_change findings', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const res = await returning([finding(app.id, 'no_change')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 0 skipped');
    expect(proposalsRepo.listPending(pid)).toHaveLength(0);
  });

  it('skips a duplicate pending proposal', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    await returning([finding(app.id, 'interview')])(ctx());
    const res = await returning([finding(app.id, 'interview', 'msg-002')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 1 skipped');
    expect(proposalsRepo.listPending(pid)).toHaveLength(1);
  });

  it('skips duplicate findings within one response', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const res = await returning([finding(app.id, 'interview'), finding(app.id, 'interview', 'msg-002')])(ctx());
    expect(res.summary).toBe('1 proposals created, 0 new applications found, 1 skipped');
    expect(proposalsRepo.listPending(pid)).toHaveLength(1);
  });

  it('passes the source promptVersion through', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const h = handlerFor({
      sync: async () =>
        ({ mail_access: true, findings: [finding(app.id, 'interview')], new_applications: [], notes: '', scope_message_count: null, promptVersion: 'v7' }) as MailSyncFindings,
    });
    expect((await h(ctx())).promptVersion).toBe('v7');
  });

  it('reports the source adapter id, falling back to the configured adapter', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const fromSource = handlerFor({
      sync: async () => ({ mail_access: true, findings: [], new_applications: [], notes: '', scope_message_count: null, adapterId: 'codex' }) as MailSyncFindings,
    });
    expect((await fromSource(ctx())).adapterId).toBe('codex');
    settingsRepo.set({ adapter_id: 'custom' });
    expect((await returning([finding(app.id, 'no_change')])(ctx())).adapterId).toBe('custom');
  });

  it('calls the source with an empty list when there are no open applications', async () => {
    const seen: number[] = [];
    const handler = handlerFor({
      sync: async (input) => {
        seen.push(input.applications.length);
        return { mail_access: true, findings: [], new_applications: [], notes: '', scope_message_count: null } as MailSyncFindings;
      },
    });
    const res = await handler(ctx());
    expect(seen).toEqual([0]);
    expect(factoryCalls).toBe(1);
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 0 skipped');
  });

  it('propagates MailAccessError from the source', async () => {
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const h = handlerFor({ sync: async () => { throw new MailAccessError(); } });
    await expect(h(ctx())).rejects.toThrow('Your agent has no Gmail tool. See the setup guide in Settings.');
  });

  it("checks only the run's profile: its open applications and its reviewed message ids", async () => {
    const other = insertTestProfile(db, 'Other profile');
    const mine = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const theirs = applicationsRepo.create({ profile_id: other, company: 'Initech', role: 'SRE' });
    // A message already reviewed in the other profile must still be offered here.
    const otherRun = runsRepo.create('sync_mail', other, { adapter_id: '', prompt_version: null });
    const [reviewed] = proposalsRepo.createMany(otherRun.id, [
      { ...finding(theirs.id, 'rejected', 'msg-other'), proposed_status: 'rejected' },
    ]);
    proposalsRepo.decide(reviewed!.id, 'rejected');
    const seen: { ids: string[]; reviewed: string[] }[] = [];
    const handler = handlerFor({
      sync: async (input) => {
        seen.push({ ids: input.applications.map((a) => a.id), reviewed: input.reviewed_message_ids });
        return { mail_access: true, findings: [finding(mine.id, 'interview'), finding(theirs.id, 'offer')], new_applications: [], notes: '', scope_message_count: null } as MailSyncFindings;
      },
    });
    const res = await handler(ctx());
    expect(seen).toEqual([{ ids: [mine.id], reviewed: [] }]);
    expect(logs).toContain(`Dropping finding for unknown application "${theirs.id}"`);
    expect(res.summary).toBe('1 proposals created, 0 new applications found, 0 skipped');
    expect(proposalsRepo.listPending(pid).map((p) => p.application_id)).toEqual([mine.id]);
    expect(proposalsRepo.listPending(other)).toEqual([]);
  });

  it.each([
    ['label', '', null],
    ['label', 'Jobs/Frontend', 'label:Jobs-Frontend'],
    ['query', 'to:you+frontend@example.com', 'to:you+frontend@example.com'],
  ] as const)("sends the run profile's %s scope %j as %j", async (kind, value, expected) => {
    db.prepare('UPDATE profiles SET mail_filter_kind = ?, mail_filter = ? WHERE id = ?').run(kind, value, pid);
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const scopes: (string | null)[] = [];
    const handler = handlerFor({
      sync: async (input) => {
        scopes.push(input.mail_scope);
        return { mail_access: true, findings: [], new_applications: [], notes: '', scope_message_count: null } as MailSyncFindings;
      },
    });
    await handler(ctx());
    expect(scopes).toEqual([expected]);
  });

  it.each([
    ['a scoped run whose scope matched nothing', 'Jobs/Frontend', 0, '0 proposals created, 0 new applications found, 0 skipped; the Gmail scope matched no mail'],
    ['a scoped run whose scope matched mail', 'Jobs/Frontend', 4, '0 proposals created, 0 new applications found, 0 skipped'],
    ['a scoped run without a count', 'Jobs/Frontend', null, '0 proposals created, 0 new applications found, 0 skipped'],
    ['a run without a scope', '', 0, '0 proposals created, 0 new applications found, 0 skipped'],
  ] as const)('summarises %s', async (_name, label, count, summary) => {
    db.prepare("UPDATE profiles SET mail_filter_kind = 'label', mail_filter = ? WHERE id = ?").run(label, pid);
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const handler = handlerFor({
      sync: async () => ({ mail_access: true, findings: [], new_applications: [], notes: '', scope_message_count: count }) as MailSyncFindings,
    });
    const res = await handler(ctx());
    expect(res.summary).toBe(summary);
    const warned = logs.includes('The Gmail scope matched no mail; check the label or search on the Profile page');
    expect(warned).toBe(summary.endsWith('matched no mail'));
  });
});

function newApp(company: string, role: string, msg: string, overrides: Record<string, unknown> = {}) {
  return {
    company,
    role,
    status: 'applied',
    applied_at: '2026-02-01',
    sender_domain: '',
    confidence: 0.8,
    reason: 'Application confirmation',
    evidence: { message_id: msg, date: '2026-02-01', from: 'no-reply@ats.example.com', subject: 'Thanks', snippet: 'Received' },
    ...overrides,
  };
}

function returningNew(newApplications: unknown[], findings: unknown[] = []) {
  return handlerFor({
    sync: async () => ({ mail_access: true, findings, new_applications: newApplications, notes: '', scope_message_count: null }) as MailSyncFindings,
  });
}

function addJob(company: string, title: string, url: string) {
  const run = runsRepo.create('discover_jobs', pid, { adapter_id: 'claude', prompt_version: null });
  return jobsRepo.insertMany(run.id, [sampleJob({ company, title, url, canonical_url: url, dedupe_key: `${company}|${title}|${url}` })])[0]!;
}

describe('mail sync handler: new applications', () => {
  it('stores cleaned new-application proposals from a profile with no applications', async () => {
    const c = ctx();
    const res = await returningNew([
      newApp('  Initech  Corp ', 'Platform   Engineer', 'msg-010', { sender_domain: '@Initech.example.com' }),
      newApp('Hooli', 'SRE', 'msg-011', { status: 'interview', sender_domain: 'greenhouse.io' }),
    ])(c);

    expect(res.summary).toBe('0 proposals created, 2 new applications found, 0 skipped');
    const stored = applicationProposalsRepo.listPending(pid);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      run_id: c.run.id,
      company: 'Initech Corp',
      role: 'Platform Engineer',
      status: 'applied',
      applied_at: new Date(2026, 1, 1).toISOString(),
      sender_domains: ['initech.example.com'],
      job_id: null,
      url: null,
      confidence: 0.8,
      reason: 'Application confirmation',
    });
    expect(stored[0]?.evidence.message_id).toBe('msg-010');
    expect(stored[1]).toMatchObject({ company: 'Hooli', status: 'interview', sender_domains: [] });
  });

  it('drops entries without a company or a role', async () => {
    const res = await returningNew([newApp(' ', 'SRE', 'msg-010'), newApp('Acme', '', 'msg-011')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 2 skipped');
    expect(applicationProposalsRepo.listPending(pid)).toEqual([]);
    expect(logs).toContain('Dropping new application without a company or role');
  });

  it('skips an application already tracked, ignoring case and blanks', async () => {
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Senior Engineer', status: 'rejected' });
    const res = await returningNew([newApp('ACME', 'senior  engineer', 'msg-010')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 1 skipped');
    expect(applicationProposalsRepo.listPending(pid)).toEqual([]);
    expect(logs).toContain('Skipping new application already tracked: ACME - senior engineer');
  });

  it('turns mail about a saved application into a status proposal with the mail date (decision 10A)', async () => {
    const saved = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'saved' });
    const res = await returningNew([newApp('acme', 'Engineer', 'msg-010', { status: 'interview', applied_at: '2026-01-20' })])(ctx());

    expect(res.summary).toBe('1 proposals created, 0 new applications found, 0 skipped');
    expect(applicationProposalsRepo.listPending(pid)).toEqual([]);
    const [p] = proposalsRepo.listPending(pid);
    expect(p).toMatchObject({
      application_id: saved.id,
      proposed_status: 'interview',
      applied_at: new Date(2026, 0, 20).toISOString(),
      confidence: 0.8,
      reason: 'Application confirmation',
    });
    expect(p?.evidence.message_id).toBe('msg-010');
  });

  it('skips a saved application that already has the same pending proposal', async () => {
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'saved' });
    await returningNew([newApp('Acme', 'Engineer', 'msg-010')])(ctx());
    const res = await returningNew([newApp('Acme', 'Engineer', 'msg-011')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 1 skipped');
    expect(proposalsRepo.listPending(pid)).toHaveLength(1);
  });

  it('skips a pending proposal again, a repeated message and repeats within one response', async () => {
    await returningNew([newApp('Acme', 'Engineer', 'msg-010')])(ctx());
    const res = await returningNew([
      newApp('acme', 'engineer', 'msg-020'),
      newApp('Globex', 'SRE', 'msg-010'),
      newApp('Initech', 'Dev', 'msg-030'),
      newApp('Initech', 'Dev', 'msg-031'),
    ])(ctx());
    expect(res.summary).toBe('0 proposals created, 1 new applications found, 3 skipped');
    expect(applicationProposalsRepo.listPending(pid).map((p) => p.company)).toEqual(['Acme', 'Initech']);
  });

  it('links the one job with the same company and title that has no application, and takes its link', async () => {
    const job = addJob('Acme', 'Backend Engineer', 'https://careers.acme.example.com/jobs/1');
    const res = await returningNew([newApp('acme', 'backend engineer', 'msg-010')])(ctx());
    expect(res.summary).toBe('0 proposals created, 1 new applications found, 0 skipped');
    expect(applicationProposalsRepo.listPending(pid)[0]).toMatchObject({
      job_id: job.id,
      url: 'https://careers.acme.example.com/jobs/1',
      sender_domains: ['careers.acme.example.com'],
    });
  });

  it('links no job when two jobs match or the only match already has an application', async () => {
    addJob('Acme', 'Engineer', 'https://acme.example.com/jobs/1');
    addJob('Acme', 'Engineer', 'https://acme.example.com/jobs/2');
    const taken = addJob('Globex', 'SRE', 'https://globex.example.com/jobs/3');
    applicationsRepo.create({ profile_id: pid, job_id: taken.id, company: 'Globex Inc', role: 'Site Reliability' });
    await returningNew([newApp('Acme', 'Engineer', 'msg-010'), newApp('Globex', 'SRE', 'msg-011')])(ctx());
    expect(applicationProposalsRepo.listPending(pid).map((p) => [p.company, p.job_id, p.url])).toEqual([
      ['Acme', null, null],
      ['Globex', null, null],
    ]);
  });

  it('never proposes a company and role again once a proposal for it was rejected or accepted (decision 12A)', async () => {
    await returningNew([newApp('Acme', 'Engineer', 'msg-010'), newApp('Globex', 'SRE', 'msg-011')])(ctx());
    const [acme, globex] = applicationProposalsRepo.listPending(pid);
    applicationProposalsRepo.decide(acme!.id, 'rejected', null);
    const app = applicationsRepo.create({ profile_id: pid, company: 'Globex Corp', role: 'Site Reliability Engineer' });
    applicationProposalsRepo.decide(globex!.id, 'accepted', app.id);

    const res = await returningNew([newApp('ACME', 'engineer', 'msg-020'), newApp('Globex', 'SRE', 'msg-021')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 2 skipped');
    expect(applicationProposalsRepo.listPending(pid)).toEqual([]);
    expect(logs).toContain('Skipping new application already proposed: ACME - engineer');
  });

  it("skips a new application whose message is this run's status evidence or an already reviewed one", async () => {
    const open = applicationsRepo.create({ profile_id: pid, company: 'Acme Corp', role: 'Senior Engineer' });
    const old = runsRepo.create('sync_mail', pid, { adapter_id: '', prompt_version: null });
    const [reviewed] = proposalsRepo.createMany(old.id, [finding(open.id, 'screening', 'msg-reviewed') as never]);
    proposalsRepo.decide(reviewed!.id, 'rejected');

    const res = await returningNew(
      [newApp('Acme', 'Senior Software Engineer', 'msg-001'), newApp('Initech', 'Dev', 'msg-reviewed')],
      [finding(open.id, 'interview', 'msg-001')],
    )(ctx());
    expect(res.summary).toBe('1 proposals created, 0 new applications found, 2 skipped');
    expect(applicationProposalsRepo.listPending(pid)).toEqual([]);
  });

  it('drops repeats for one saved application within a response (S5)', async () => {
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'saved' });
    const res = await returningNew([
      newApp('Acme', 'Engineer', 'msg-010', { status: 'applied' }),
      newApp('acme', 'engineer', 'msg-011', { status: 'interview' }),
    ])(ctx());
    expect(res.summary).toBe('1 proposals created, 0 new applications found, 1 skipped');
    expect(proposalsRepo.listPending(pid).map((p) => p.proposed_status)).toEqual(['applied']);
  });

  it('saves nothing when storing the new applications fails after the status proposals (S3)', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    vi.spyOn(applicationProposalsRepo, 'createMany').mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(returningNew([newApp('Initech', 'Dev', 'msg-010')], [finding(app.id, 'interview')])(ctx())).rejects.toThrow(
      'disk full',
    );
    expect(proposalsRepo.listPending(pid)).toEqual([]);
  });

  it('sends the agent the applications and proposals it must not report again (decision 14A)', async () => {
    applicationsRepo.create({ profile_id: pid, company: 'Open Co', role: 'Dev' });
    applicationsRepo.create({ profile_id: pid, company: 'Saved Co', role: 'Dev', status: 'saved' });
    applicationsRepo.create({ profile_id: pid, company: 'Closed Co', role: 'Dev', status: 'rejected' });
    const old = runsRepo.create('sync_mail', pid, { adapter_id: '', prompt_version: null });
    const base = {
      status: 'applied' as const, applied_at: 't', job_id: null, url: null, sender_domains: [], confidence: 0.5, reason: 'r',
      evidence: { message_id: 'msg-x', date: '', from: '', subject: '', snippet: '' },
    };
    const [rejected] = applicationProposalsRepo.createMany(old.id, pid, [
      { ...base, company: 'Rejected Co', role: 'Dev' },
      { ...base, company: 'Pending Co', role: 'Dev', evidence: { ...base.evidence, message_id: 'msg-y' } },
    ]);
    applicationProposalsRepo.decide(rejected!.id, 'rejected', null);
    const seen: { company: string; role: string }[][] = [];
    const handler = handlerFor({
      sync: async (input) => {
        seen.push(input.tracked);
        return { mail_access: true, findings: [], new_applications: [], notes: '', scope_message_count: null } as MailSyncFindings;
      },
    });
    await handler(ctx());
    expect(seen[0]!.map((t) => t.company).sort()).toEqual(['Closed Co', 'Pending Co', 'Rejected Co']);
  });

  it('keeps a saved application off the tracked list even when a proposal had its company and role (14A, 10A)', async () => {
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'saved' });
    const old = runsRepo.create('sync_mail', pid, { adapter_id: '', prompt_version: null });
    const [p] = applicationProposalsRepo.createMany(old.id, pid, [
      {
        company: 'ACME', role: 'engineer', status: 'applied', applied_at: 't', job_id: null, url: null, sender_domains: [],
        confidence: 0.5, reason: 'r', evidence: { message_id: 'msg-x', date: '', from: '', subject: '', snippet: '' },
      },
    ]);
    applicationProposalsRepo.decide(p!.id, 'rejected', null);
    const seen: { company: string; role: string }[][] = [];
    const handler = handlerFor({
      sync: async (input) => {
        seen.push(input.tracked);
        return { mail_access: true, findings: [], new_applications: [], notes: '', scope_message_count: null } as MailSyncFindings;
      },
    });
    await handler(ctx());
    expect(seen[0]).toEqual([]);
  });

  it('names each skipped entry for a saved application and each one past the cap (S6)', async () => {
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'saved' });
    const many = Array.from({ length: 501 }, (_, i) => newApp(`Company ${i}`, 'Engineer', `msg-${i}`));
    await returningNew([newApp('Acme', 'Engineer', 'msg-a'), newApp('Acme', 'Engineer', 'msg-b'), ...many])(ctx());
    expect(logs).toContain('Skipping new application for a saved one already proposed: Acme - Engineer');
    expect(logs).toContain('Skipping new application past the limit of 500: Company 500 - Engineer');
  });

  it('never treats a blank message id as already used (S2)', async () => {
    const res = await returningNew([
      newApp('Acme', 'Engineer', ''),
      newApp('Globex', 'SRE', '  '),
    ])(ctx());
    expect(res.summary).toBe('0 proposals created, 2 new applications found, 0 skipped');
    expect(applicationProposalsRepo.messageIds(pid)).toEqual([]);
  });

  it('keeps at most 500 new applications per run (decision 2B)', async () => {
    const many = Array.from({ length: 502 }, (_, i) => newApp(`Company ${i}`, 'Engineer', `msg-${i}`));
    const res = await returningNew(many)(ctx());
    expect(res.summary).toBe('0 proposals created, 500 new applications found, 2 skipped');
    expect(applicationProposalsRepo.listPending(pid)).toHaveLength(500);
    expect(logs).toContain('Keeping the first 500 new applications; the next sync looks again');
  });

  it('sends new-application message ids as reviewed and a 90-day lookback day', async () => {
    const run = runsRepo.create('sync_mail', pid, { adapter_id: '', prompt_version: null });
    const [rejected] = applicationProposalsRepo.createMany(run.id, pid, [
      {
        company: 'Acme', role: 'Engineer', status: 'applied', applied_at: 't', job_id: null, url: null, sender_domains: [],
        confidence: 0.5, reason: 'r', evidence: { message_id: 'msg-old', date: '', from: '', subject: '', snippet: '' },
      },
    ]);
    applicationProposalsRepo.decide(rejected!.id, 'rejected', null);
    const seen: { reviewed: string[]; since: string }[] = [];
    const handler = handlerFor({
      sync: async (input) => {
        seen.push({ reviewed: input.reviewed_message_ids, since: input.new_applications_since });
        return { mail_access: true, findings: [], new_applications: [], notes: '', scope_message_count: null } as MailSyncFindings;
      },
    });
    const before = new Date();
    await handler(ctx());
    expect(seen[0]?.reviewed).toEqual(['msg-old']);
    const expected = new Date(before.getFullYear(), before.getMonth(), before.getDate() - 90);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(seen[0]?.since).toBe(`${expected.getFullYear()}/${pad(expected.getMonth() + 1)}/${pad(expected.getDate())}`);
  });

  it('saves no new applications when the run is cancelled before saving', async () => {
    const handler = returningNew([newApp('Acme', 'Engineer', 'msg-010')]);
    const refusing = { ...ctx(), beginSaving: () => { throw new Error('Aborted'); } };
    await expect(handler(refusing)).rejects.toThrow('Aborted');
    expect(applicationProposalsRepo.listPending(pid)).toEqual([]);
  });
});

// A scoped sync returns per-thread records; the handler groups them and records the threads read (SOW-0051).
let t = 0;
function thread(over: Record<string, unknown> = {}) {
  t++;
  return {
    thread_id: `thr-${t}`,
    application_id: '',
    company: 'Initech',
    role: 'Platform Engineer',
    status: 'applied' as const,
    first_date: '2026-10-01',
    sender_domain: '',
    confidence: 0.8,
    reason: 'Confirmation',
    evidence: { message_id: `msg-t${t}`, date: '2026-10-01T09:00:00Z', from: 'no-reply@ats.example.com', subject: 'Thanks', snippet: 'Received' },
    ...over,
  };
}

function scopedResult(records: ReturnType<typeof thread>[], over: Partial<ThreadSyncResult> = {}, read?: string[]): MailSyncFindings {
  const ids = read ?? records.map((r) => r.thread_id);
  return {
    mail_access: true,
    findings: [],
    new_applications: [],
    notes: '',
    scope_message_count: ids.length,
    promptVersion: 'list 1 + read 1',
    threads: {
      records,
      read: ids.map((id) => ({ thread_id: id, last_message_id: `last-${id}` })),
      listed: ids.length,
      uncovered: [],
      batches: { total: 1, failed: 0 },
      unread: 0,
      ...over,
    },
  };
}

function scopedProfile() {
  db.prepare("UPDATE profiles SET mail_filter_kind = 'label', mail_filter = 'jobapplications' WHERE id = ?").run(pid);
}

describe('mail sync handler: scoped syncs', () => {
  it('passes the threads read before and today to the mail source', async () => {
    scopedProfile();
    mailThreadsRepo.upsertMany(pid, [{ thread_id: 'thr-old', last_message_id: 'msg-old' }]);
    const seen: { known: Map<string, string>; today: string }[] = [];
    const handler = handlerFor({
      sync: async (input) => {
        seen.push({ known: input.known_threads, today: input.today });
        return scopedResult([]);
      },
    });
    const now = new Date();
    await handler(ctx());
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(seen[0]?.known).toEqual(new Map([['thr-old', 'msg-old']]));
    expect(seen[0]?.today).toBe(`${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`);
  });

  it('groups the threads into status and new-application proposals and records every thread read', async () => {
    scopedProfile();
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'applied', applied_at: '2026-09-01T00:00:00.000Z' });
    const reply = thread({ application_id: app.id, company: 'Acme', role: 'Engineer', status: 'interview' });
    const first = thread({ first_date: '2026-10-02' });
    const later = thread({ role: '', status: 'rejected', first_date: '2026-10-20', evidence: { ...thread().evidence, message_id: 'msg-rej', date: '2026-10-21T09:00:00Z' } });
    const c = ctx();
    const res = await handlerFor({ sync: async () => scopedResult([reply, first, later], {}, [reply.thread_id, first.thread_id, later.thread_id, 'thr-news']) })(c);

    expect(res.summary).toBe('1 proposals created, 1 new applications found, 0 skipped');
    expect(res.promptVersion).toBe('list 1 + read 1');
    expect(proposalsRepo.listPending(pid).map((p) => [p.application_id, p.proposed_status])).toEqual([[app.id, 'interview']]);
    const [fresh] = applicationProposalsRepo.listPending(pid);
    expect(fresh).toMatchObject({ company: 'Initech', role: 'Platform Engineer', status: 'rejected' });
    expect(fresh!.evidence.message_id).toBe('msg-rej');
    expect(new Date(fresh!.applied_at).getDate()).toBe(2);
    expect(mailThreadsRepo.known(pid)).toEqual(
      new Map([reply.thread_id, first.thread_id, later.thread_id, 'thr-news'].map((id) => [id, `last-${id}`])),
    );
  });

  it('skips a status finding whose message was already reviewed', async () => {
    scopedProfile();
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'applied', applied_at: '2026-09-01T00:00:00.000Z' });
    const run = runsRepo.create('sync_mail', pid, { adapter_id: '', prompt_version: null });
    const [old] = proposalsRepo.createMany(run.id, [
      { application_id: app.id, proposed_status: 'interview', confidence: 0.9, reason: 'r', evidence: { message_id: 'msg-seen', date: '', from: '', subject: '', snippet: '' } },
    ]);
    proposalsRepo.decide(old!.id, 'rejected');
    const reply = thread({ application_id: app.id, status: 'interview', evidence: { ...thread().evidence, message_id: 'msg-seen' } });
    const res = await handlerFor({ sync: async () => scopedResult([reply]) })(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 1 skipped');
    expect(logs).toContain(`Skipping a finding from a message already reviewed: ${app.id}`);
  });

  it('leaves the threads of a new application skipped by the cap unread, so the next sync reads them again', async () => {
    scopedProfile();
    const records = Array.from({ length: 501 }, (_, i) => thread({ company: `Company ${String(i).padStart(3, '0')}`, first_date: '2026-10-01' }));
    await handlerFor({ sync: async () => scopedResult(records) })(ctx());
    expect(applicationProposalsRepo.listPending(pid)).toHaveLength(500);
    const known = mailThreadsRepo.known(pid);
    expect(known.size).toBe(500);
    expect(known.has(records[500]!.thread_id)).toBe(false);
  });

  it('logs what grouping skipped', async () => {
    scopedProfile();
    await handlerFor({ sync: async () => scopedResult([thread({ company: ' ' })]) })(ctx());
    expect(logs).toContain('Skipping a thread without a company');
  });

  it('notes failed batches and date ranges it could not confirm', async () => {
    scopedProfile();
    const res = await handlerFor({
      sync: async () => scopedResult([], { batches: { total: 4, failed: 1 }, uncovered: [{ after: '2026/10/01', before: '' }] }),
    })(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 0 skipped; 1 of 4 batches failed; some mail may not have been listed');
  });

  it('says the scope matched nothing only when it listed no thread and covered every date', async () => {
    scopedProfile();
    const none = await handlerFor({ sync: async () => scopedResult([], { listed: 0 }, []) })(ctx());
    expect(none.summary).toBe('0 proposals created, 0 new applications found, 0 skipped; the Gmail scope matched no mail');
    const partial = await handlerFor({
      sync: async () => scopedResult([], { listed: 0, uncovered: [{ after: '', before: '' }] }, []),
    })(ctx());
    expect(partial.summary).toBe('0 proposals created, 0 new applications found, 0 skipped; some mail may not have been listed');
  });

  it('leaves a thread unread while a pending proposal blocks its application, and reads it once that is decided (review H1)', async () => {
    scopedProfile();
    const run = runsRepo.create('sync_mail', pid, { adapter_id: '', prompt_version: null });
    const evidence = { message_id: 'msg-first', date: '2026-10-01', from: '', subject: '', snippet: '' };
    const [pending] = applicationProposalsRepo.createMany(run.id, pid, [
      { company: 'Initech', role: 'Platform Engineer', status: 'applied', applied_at: 't', job_id: null, url: null, sender_domains: [], confidence: 0.8, reason: 'r', evidence },
    ]);
    const rejection = thread({ status: 'rejected', evidence: { ...thread().evidence, message_id: 'msg-rej' } });
    await handlerFor({ sync: async () => scopedResult([rejection]) })(ctx());
    expect(logs).toContain('Skipping new application already proposed: Initech - Platform Engineer');
    expect(mailThreadsRepo.known(pid).has(rejection.thread_id)).toBe(false);

    applicationProposalsRepo.decide(pending!.id, 'rejected', null);
    await handlerFor({ sync: async () => scopedResult([rejection]) })(ctx());
    expect(mailThreadsRepo.known(pid).has(rejection.thread_id)).toBe(true);
  });

  it('proposes nothing when the mail shows the status the application already has (review H2)', async () => {
    scopedProfile();
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'interview', applied_at: '2026-09-01T00:00:00.000Z' });
    const res = await handlerFor({ sync: async () => scopedResult([thread({ application_id: app.id, status: 'interview' })]) })(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 0 skipped');
    expect(proposalsRepo.listPending(pid)).toEqual([]);
  });

  it('never proposes moving an application back to an earlier stage (decision 13B)', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer', status: 'interview', applied_at: '2026-09-01T00:00:00.000Z' });
    const res = await returning([finding(app.id, 'screening')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 0 skipped');
    expect(proposalsRepo.listPending(pid)).toEqual([]);
    await returning([finding(app.id, 'rejected', 'msg-777')])(ctx());
    expect(proposalsRepo.listPending(pid).map((p) => p.proposed_status)).toEqual(['rejected']);
  });

  // Decision 14B: a scheduled sync lists only mail since the last complete listing; a manual one lists all.
  const today = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
  };
  function scheduledCtx(): RunContext {
    const c = ctx();
    writeFileSync(join(c.runDir, 'input.json'), JSON.stringify({ trigger: 'schedule' }));
    return c;
  }
  function capturing(result: () => MailSyncFindings = () => scopedResult([])) {
    const since: (string | null)[] = [];
    const handler = handlerFor({
      sync: async (input) => {
        since.push(input.list_since);
        return result();
      },
    });
    return { since, handler };
  }

  it('a manual sync lists all mail and marks a complete listing with its day', async () => {
    scopedProfile();
    mailThreadsRepo.setListing(pid, 'label:jobapplications', '2026/11/01');
    const { since, handler } = capturing();
    await handler(ctx());
    expect(since).toEqual([null]);
    expect(mailThreadsRepo.listing(pid)).toEqual({ scope: 'label:jobapplications', listed_through: today() });
  });

  it('a scheduled sync lists from the day before the last complete listing', async () => {
    scopedProfile();
    mailThreadsRepo.setListing(pid, 'label:jobapplications', '2026/11/01');
    const { since, handler } = capturing();
    await handler(scheduledCtx());
    expect(since).toEqual(['2026/10/31']);
    expect(mailThreadsRepo.listing(pid)?.listed_through).toBe(today());
  });

  it('does not say the scope matched nothing when a scheduled sync found no recent mail', async () => {
    scopedProfile();
    mailThreadsRepo.setListing(pid, 'label:jobapplications', '2026/11/01');
    const res = await capturing(() => scopedResult([], { listed: 0 }, [])).handler(scheduledCtx());
    expect(res.summary).toBe('0 proposals created, 0 new applications found, 0 skipped');
    expect(logs).not.toContain('The Gmail scope matched no mail; check the label or search on the Profile page');
  });

  it('a scheduled sync lists all mail without a mark, or when the scope changed since it', async () => {
    scopedProfile();
    const first = capturing();
    await first.handler(scheduledCtx());
    expect(first.since).toEqual([null]);
    expect(logs).toContain('Scheduled sync lists all mail: no complete listing yet');

    mailThreadsRepo.setListing(pid, 'label:other', '2026/11/01');
    const second = capturing();
    await second.handler(scheduledCtx());
    expect(second.since).toEqual([null]);
    expect(logs).toContain('Scheduled sync lists all mail: the Gmail label or search changed');
  });

  it.each([
    ['dates the listing could not confirm', () => scopedResult([], { uncovered: [{ after: '2026/11/01', before: '' }] })],
    ['threads it could not read', () => scopedResult([], { unread: 3, batches: { total: 2, failed: 1 } })],
  ] as const)('keeps the old mark when there were %s', async (_name, result) => {
    scopedProfile();
    mailThreadsRepo.setListing(pid, 'label:jobapplications', '2026/11/01');
    await capturing(result).handler(ctx());
    expect(mailThreadsRepo.listing(pid)?.listed_through).toBe('2026/11/01');
  });

  it('keeps the old mark when a read thread was left out of the ledger (cap or pending proposal)', async () => {
    scopedProfile();
    mailThreadsRepo.setListing(pid, 'label:jobapplications', '2026/11/01');
    const run = runsRepo.create('sync_mail', pid, { adapter_id: '', prompt_version: null });
    const evidence = { message_id: 'msg-first', date: '2026-10-01', from: '', subject: '', snippet: '' };
    applicationProposalsRepo.createMany(run.id, pid, [
      { company: 'Initech', role: 'Platform Engineer', status: 'applied', applied_at: 't', job_id: null, url: null, sender_domains: [], confidence: 0.8, reason: 'r', evidence },
    ]);
    await capturing(() => scopedResult([thread({ status: 'rejected' })])).handler(ctx());
    expect(mailThreadsRepo.listing(pid)?.listed_through).toBe('2026/11/01');
  });

  it('a sync without a scope neither lists nor marks', async () => {
    const { since, handler } = capturing(() => ({ mail_access: true, findings: [], new_applications: [], notes: '', scope_message_count: null }) as MailSyncFindings);
    await handler(scheduledCtx());
    expect(since).toEqual([null]);
    expect(mailThreadsRepo.listing(pid)).toBeNull();
  });

  it('records no thread when saving is refused', async () => {
    scopedProfile();
    const handler = handlerFor({ sync: async () => scopedResult([thread()]) });
    const refusing = { ...ctx(), beginSaving: () => { throw new Error('Aborted'); } };
    await expect(handler(refusing)).rejects.toThrow('Aborted');
    expect(mailThreadsRepo.known(pid)).toEqual(new Map());
  });
});

