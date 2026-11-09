import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createApplicationsRepo } from '../../../src/server/db/applications-repo.js';
import { createProfilesRepo } from '../../../src/server/db/profiles-repo.js';
import { createProposalsRepo } from '../../../src/server/db/proposals-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { createSettingsRepo } from '../../../src/server/db/settings-repo.js';
import { MailAccessError, type MailSource, type MailSyncFindings } from '../../../src/server/mail/types.js';
import type { RunContext } from '../../../src/server/runs/queue.js';
import { createMailSyncHandler } from '../../../src/server/services/mail-sync.js';
import { insertTestProfile } from '../db/test-profile.js';

let db: Db;
let applicationsRepo: ReturnType<typeof createApplicationsRepo>;
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
    applicationsRepo,
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
  return handlerFor({ sync: async () => ({ mail_access: true, findings, notes: '' }) as MailSyncFindings });
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
        return { mail_access: true, findings: [finding(app.id, 'interview')], notes: '' } as MailSyncFindings;
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
        return { mail_access: true, findings: [], notes: '', scope_message_count: null } as MailSyncFindings;
      },
    });
    await handler(c);
    expect(runsRepo.get(c.run.id)).toMatchObject({ adapter_id: 'claude', agent_model: 'sonnet', agent_effort: 'low' });
  });

  it('creates a pending proposal with evidence', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const res = await returning([finding(app.id, 'interview')])(ctx());
    expect(res.summary).toBe('1 proposals created, 0 skipped');
    const [p] = proposalsRepo.listPending(pid);
    expect(p?.application_id).toBe(app.id);
    expect(p?.proposed_status).toBe('interview');
    expect(p?.evidence.message_id).toBe('msg-001');
    expect(logs).toContain(res.summary);
  });

  it('drops findings for unknown applications', async () => {
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const res = await returning([finding('nope', 'interview')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 skipped');
    expect(proposalsRepo.listPending(pid)).toHaveLength(0);
    expect(logs.some((l) => l.includes('unknown application'))).toBe(true);
  });

  it('ignores no_change findings', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const res = await returning([finding(app.id, 'no_change')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 skipped');
    expect(proposalsRepo.listPending(pid)).toHaveLength(0);
  });

  it('skips a duplicate pending proposal', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    await returning([finding(app.id, 'interview')])(ctx());
    const res = await returning([finding(app.id, 'interview', 'msg-002')])(ctx());
    expect(res.summary).toBe('0 proposals created, 1 skipped');
    expect(proposalsRepo.listPending(pid)).toHaveLength(1);
  });

  it('skips duplicate findings within one response', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const res = await returning([finding(app.id, 'interview'), finding(app.id, 'interview', 'msg-002')])(ctx());
    expect(res.summary).toBe('1 proposals created, 1 skipped');
    expect(proposalsRepo.listPending(pid)).toHaveLength(1);
  });

  it('passes the source promptVersion through', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const h = handlerFor({
      sync: async () =>
        ({ mail_access: true, findings: [finding(app.id, 'interview')], notes: '', promptVersion: 'v7' }) as MailSyncFindings,
    });
    expect((await h(ctx())).promptVersion).toBe('v7');
  });

  it('reports the source adapter id, falling back to the configured adapter', async () => {
    const app = applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const fromSource = handlerFor({
      sync: async () => ({ mail_access: true, findings: [], notes: '', scope_message_count: null, adapterId: 'codex' }) as MailSyncFindings,
    });
    expect((await fromSource(ctx())).adapterId).toBe('codex');
    settingsRepo.set({ adapter_id: 'custom' });
    expect((await returning([finding(app.id, 'no_change')])(ctx())).adapterId).toBe('custom');
  });

  it('does not call the source when there are no open applications', async () => {
    const res = await returning([])(ctx());
    expect(res.summary).toBe('no open applications');
    expect(factoryCalls).toBe(0);
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
        return { mail_access: true, findings: [finding(mine.id, 'interview'), finding(theirs.id, 'offer')], notes: '' } as MailSyncFindings;
      },
    });
    const res = await handler(ctx());
    expect(seen).toEqual([{ ids: [mine.id], reviewed: [] }]);
    expect(logs).toContain(`Dropping finding for unknown application ${theirs.id}`);
    expect(res.summary).toBe('1 proposals created, 0 skipped');
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
        return { mail_access: true, findings: [], notes: '', scope_message_count: null } as MailSyncFindings;
      },
    });
    await handler(ctx());
    expect(scopes).toEqual([expected]);
  });

  it.each([
    ['a scoped run whose scope matched nothing', 'Jobs/Frontend', 0, '0 proposals created, 0 skipped; the Gmail scope matched no mail'],
    ['a scoped run whose scope matched mail', 'Jobs/Frontend', 4, '0 proposals created, 0 skipped'],
    ['a scoped run without a count', 'Jobs/Frontend', null, '0 proposals created, 0 skipped'],
    ['a run without a scope', '', 0, '0 proposals created, 0 skipped'],
  ] as const)('summarises %s', async (_name, label, count, summary) => {
    db.prepare("UPDATE profiles SET mail_filter_kind = 'label', mail_filter = ? WHERE id = ?").run(label, pid);
    applicationsRepo.create({ profile_id: pid, company: 'Acme', role: 'Engineer' });
    const handler = handlerFor({
      sync: async () => ({ mail_access: true, findings: [], notes: '', scope_message_count: count }) as MailSyncFindings,
    });
    const res = await handler(ctx());
    expect(res.summary).toBe(summary);
    const warned = logs.includes('The Gmail scope matched no mail; check the label or search on the Profile page');
    expect(warned).toBe(summary.endsWith('matched no mail'));
  });
});
