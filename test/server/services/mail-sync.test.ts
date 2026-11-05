import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../../src/server/db/connection.js';
import { createApplicationsRepo } from '../../../src/server/db/applications-repo.js';
import { createProposalsRepo } from '../../../src/server/db/proposals-repo.js';
import { createRunsRepo } from '../../../src/server/db/runs-repo.js';
import { createSettingsRepo } from '../../../src/server/db/settings-repo.js';
import { MailAccessError, type MailSource, type MailSyncFindings } from '../../../src/server/mail/types.js';
import type { RunContext } from '../../../src/server/runs/queue.js';
import { createMailSyncHandler } from '../../../src/server/services/mail-sync.js';

let db: Db;
let applicationsRepo: ReturnType<typeof createApplicationsRepo>;
let proposalsRepo: ReturnType<typeof createProposalsRepo>;
let settingsRepo: ReturnType<typeof createSettingsRepo>;
let runsRepo: ReturnType<typeof createRunsRepo>;
let logs: string[];
let factoryCalls: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  applicationsRepo = createApplicationsRepo(db);
  proposalsRepo = createProposalsRepo(db);
  settingsRepo = createSettingsRepo(db);
  runsRepo = createRunsRepo(db);
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

function ctx(): RunContext {
  const run = runsRepo.create('sync_mail', { adapter_id: 'custom', prompt_version: null });
  return {
    run,
    log: (l) => logs.push(l),
    signal: new AbortController().signal,
    runDir: mkdtempSync(join(tmpdir(), 'mail-sync-')),
  };
}

describe('mail sync handler', () => {
  it('creates a pending proposal with evidence', async () => {
    const app = applicationsRepo.create({ company: 'Acme', role: 'Engineer' });
    const res = await returning([finding(app.id, 'interview')])(ctx());
    expect(res.summary).toBe('1 proposals created, 0 skipped');
    const [p] = proposalsRepo.listPending();
    expect(p?.application_id).toBe(app.id);
    expect(p?.proposed_status).toBe('interview');
    expect(p?.evidence.message_id).toBe('msg-001');
    expect(logs).toContain(res.summary);
  });

  it('drops findings for unknown applications', async () => {
    applicationsRepo.create({ company: 'Acme', role: 'Engineer' });
    const res = await returning([finding('nope', 'interview')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 skipped');
    expect(proposalsRepo.listPending()).toHaveLength(0);
    expect(logs.some((l) => l.includes('unknown application'))).toBe(true);
  });

  it('ignores no_change findings', async () => {
    const app = applicationsRepo.create({ company: 'Acme', role: 'Engineer' });
    const res = await returning([finding(app.id, 'no_change')])(ctx());
    expect(res.summary).toBe('0 proposals created, 0 skipped');
    expect(proposalsRepo.listPending()).toHaveLength(0);
  });

  it('skips a duplicate pending proposal', async () => {
    const app = applicationsRepo.create({ company: 'Acme', role: 'Engineer' });
    await returning([finding(app.id, 'interview')])(ctx());
    const res = await returning([finding(app.id, 'interview', 'msg-002')])(ctx());
    expect(res.summary).toBe('0 proposals created, 1 skipped');
    expect(proposalsRepo.listPending()).toHaveLength(1);
  });

  it('skips duplicate findings within one response', async () => {
    const app = applicationsRepo.create({ company: 'Acme', role: 'Engineer' });
    const res = await returning([finding(app.id, 'interview'), finding(app.id, 'interview', 'msg-002')])(ctx());
    expect(res.summary).toBe('1 proposals created, 1 skipped');
    expect(proposalsRepo.listPending()).toHaveLength(1);
  });

  it('passes the source promptVersion through', async () => {
    const app = applicationsRepo.create({ company: 'Acme', role: 'Engineer' });
    const h = handlerFor({
      sync: async () =>
        ({ mail_access: true, findings: [finding(app.id, 'interview')], notes: '', promptVersion: 'v7' }) as MailSyncFindings,
    });
    expect((await h(ctx())).promptVersion).toBe('v7');
  });

  it('reports the source adapter id, falling back to the configured adapter', async () => {
    const app = applicationsRepo.create({ company: 'Acme', role: 'Engineer' });
    const fromSource = handlerFor({
      sync: async () => ({ mail_access: true, findings: [], notes: '', adapterId: 'codex' }) as MailSyncFindings,
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
    applicationsRepo.create({ company: 'Acme', role: 'Engineer' });
    const h = handlerFor({ sync: async () => { throw new MailAccessError(); } });
    await expect(h(ctx())).rejects.toThrow('Your agent has no Gmail tool. See the setup guide in Settings.');
  });
});
