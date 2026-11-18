import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createApplicationProposalsRepo } from '../../../src/server/db/application-proposals-repo.js';
import { createApplicationsRepo } from '../../../src/server/db/applications-repo.js';
import { createJobsRepo } from '../../../src/server/db/jobs-repo.js';
import { createProfilesRepo } from '../../../src/server/db/profiles-repo.js';
import { createProposalsRepo } from '../../../src/server/db/proposals-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { createSettingsRepo } from '../../../src/server/db/settings-repo.js';
import { MailAccessError, type MailSource, type MailSyncFindings } from '../../../src/server/mail/types.js';
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
    expect(logs).toContain(`Dropping finding for unknown application ${theirs.id}`);
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
    const many = Array.from({ length: 51 }, (_, i) => newApp(`Company ${i}`, 'Engineer', `msg-${i}`));
    await returningNew([newApp('Acme', 'Engineer', 'msg-a'), newApp('Acme', 'Engineer', 'msg-b'), ...many])(ctx());
    expect(logs).toContain('Skipping new application for a saved one already proposed: Acme - Engineer');
    expect(logs).toContain('Skipping new application past the limit of 50: Company 50 - Engineer');
  });

  it('never treats a blank message id as already used (S2)', async () => {
    const res = await returningNew([
      newApp('Acme', 'Engineer', ''),
      newApp('Globex', 'SRE', '  '),
    ])(ctx());
    expect(res.summary).toBe('0 proposals created, 2 new applications found, 0 skipped');
    expect(applicationProposalsRepo.messageIds(pid)).toEqual([]);
  });

  it('keeps at most 50 new applications per run', async () => {
    const many = Array.from({ length: 52 }, (_, i) => newApp(`Company ${i}`, 'Engineer', `msg-${i}`));
    const res = await returningNew(many)(ctx());
    expect(res.summary).toBe('0 proposals created, 50 new applications found, 2 skipped');
    expect(applicationProposalsRepo.listPending(pid)).toHaveLength(50);
    expect(logs).toContain('Keeping the first 50 new applications; the next sync looks again');
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
