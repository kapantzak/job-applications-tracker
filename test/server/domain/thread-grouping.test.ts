import { describe, expect, it } from 'vitest';
import { groupThreadRecords, ROLE_NOT_STATED, type GroupingInput } from '../../../src/server/domain/thread-grouping.js';
import type { ThreadRecordResult } from '../../../src/server/tasks/schemas.js';

let n = 0;
function rec(over: Partial<ThreadRecordResult> & { date?: string } = {}): ThreadRecordResult {
  n++;
  const { date, ...rest } = over;
  return {
    thread_id: `thr-${n}`,
    application_id: '',
    company: 'Acme',
    role: 'Engineer',
    status: 'applied',
    first_date: '2026-10-01',
    sender_domain: '',
    confidence: 0.8,
    reason: 'Confirmation',
    evidence: { message_id: `msg-${n}`, date: date ?? '2026-10-01T09:00:00Z', from: 'no-reply@ats.example.com', subject: 'Thanks', snippet: 'Received' },
    ...rest,
  };
}

function input(records: ThreadRecordResult[], over: Partial<GroupingInput> = {}): GroupingInput {
  return { records, open: [], applications: [], ...over };
}

describe('groupThreadRecords: new applications', () => {
  it('groups threads by company and role, earliest first date, newest status and evidence', () => {
    const a = rec({ status: 'applied', first_date: '2026-10-03', date: '2026-10-03T08:00:00Z' });
    const b = rec({ company: ' acme ', role: 'ENGINEER', status: 'rejected', first_date: '2026-10-20', date: '2026-10-21T08:00:00Z', reason: 'Rejection', sender_domain: 'acme.example.com' });
    const c = rec({ company: 'Globex', role: 'Dev', first_date: '2026-10-05' });
    const out = groupThreadRecords(input([b, a, c]));
    expect(out.findings).toEqual([]);
    expect(out.newApplications).toHaveLength(2);
    const acme = out.newApplications.find((x) => x.company.toLowerCase() === 'acme')!;
    expect(acme).toMatchObject({
      status: 'rejected',
      applied_at: '2026-10-03',
      reason: 'Rejection',
      sender_domain: 'acme.example.com',
      evidence: b.evidence,
      confidence: b.confidence,
    });
    expect(acme.thread_ids.sort()).toEqual([a.thread_id, b.thread_id].sort());
    // Oldest application first.
    expect(out.newApplications.map((x) => x.company)).toEqual(['Acme', 'Globex']);
  });

  it('breaks a date tie with the furthest stage', () => {
    const out = groupThreadRecords(input([rec({ status: 'interview', date: '2026-10-05' }), rec({ status: 'applied', date: '2026-10-05' })]));
    expect(out.newApplications[0]!.status).toBe('interview');
  });

  it('skips a thread without a company', () => {
    const out = groupThreadRecords(input([rec({ company: '  ' })]));
    expect(out.newApplications).toEqual([]);
    expect(out.logs).toContain('Skipping a thread without a company');
  });

  it('falls back to the newest first date that is not a day', () => {
    const out = groupThreadRecords(input([rec({ first_date: 'October' })]));
    expect(out.newApplications[0]!.applied_at).toBe('October');
  });
});

describe('groupThreadRecords: open applications', () => {
  const open = [{ id: 'app-1', company: 'Acme', role: 'Engineer', applied_at: '2026-09-01T00:00:00.000Z' }];

  it('makes one finding from the newest thread of an open application, by id or by name', () => {
    const byId = rec({ application_id: 'app-1', company: 'Acme Corp', role: 'Software Engineer', status: 'interview', date: '2026-10-10' });
    const byName = rec({ status: 'rejected', date: '2026-10-20', reason: 'No' });
    const out = groupThreadRecords(input([byId, byName], { open }));
    expect(out.newApplications).toEqual([]);
    expect(out.findings).toEqual([
      { application_id: 'app-1', proposed_status: 'rejected', confidence: byName.confidence, reason: 'No', evidence: byName.evidence },
    ]);
  });

  it('proposes nothing when the newest thread only shows the application', () => {
    const out = groupThreadRecords(input([rec({ application_id: 'app-1', status: 'applied', date: '2026-10-10' })], { open }));
    expect(out.findings).toEqual([]);
    expect(out.newApplications).toEqual([]);
  });

  it('ignores threads from more than a day before the application was sent', () => {
    const out = groupThreadRecords(input([rec({ application_id: 'app-1', status: 'rejected', date: '2026-08-01' })], { open }));
    expect(out.findings).toEqual([]);
  });

  it('treats an unknown application id as none and logs it', () => {
    const out = groupThreadRecords(input([rec({ application_id: 'app-x', company: 'Initech', role: 'SRE' })], { open }));
    expect(out.findings).toEqual([]);
    expect(out.newApplications.map((x) => x.company)).toEqual(['Initech']);
    expect(out.logs).toContain('Ignoring an unknown application id from the agent: "app-x"');
  });
});

describe('groupThreadRecords: threads without a role (decision 9)', () => {
  it("joins the company's only group in this sync", () => {
    const withRole = rec({ first_date: '2026-10-01', date: '2026-10-01' });
    const roleless = rec({ role: '', status: 'rejected', date: '2026-10-15' });
    const out = groupThreadRecords(input([roleless, withRole]));
    expect(out.newApplications).toHaveLength(1);
    expect(out.newApplications[0]).toMatchObject({ company: 'Acme', role: 'Engineer', status: 'rejected' });
    expect(out.newApplications[0]!.thread_ids).toHaveLength(2);
  });

  it("goes to the company's only open application when this sync has no group for it", () => {
    const open = [{ id: 'app-1', company: 'Acme', role: 'Engineer', applied_at: '2026-09-01T00:00:00.000Z' }];
    const out = groupThreadRecords(input([rec({ role: '', status: 'interview', date: '2026-10-15' })], { open }));
    expect(out.findings.map((f) => [f.application_id, f.proposed_status])).toEqual([['app-1', 'interview']]);
  });

  it("takes the role of the company's only application otherwise", () => {
    const out = groupThreadRecords(
      input([rec({ role: '', status: 'rejected' })], { applications: [{ company: 'ACME', role: 'Platform Engineer' }] }),
    );
    expect(out.newApplications[0]).toMatchObject({ company: 'ACME', role: 'Platform Engineer', status: 'rejected' });
  });

  it('is skipped when the company has two groups, two open applications or two applications', () => {
    const two = groupThreadRecords(input([rec({ role: 'A' }), rec({ role: 'B' }), rec({ role: '' })]));
    expect(two.newApplications.map((x) => x.role).sort()).toEqual(['A', 'B']);
    expect(two.logs).toContain('Skipping a thread that names no role: Acme');
    const apps = groupThreadRecords(
      input([rec({ role: '' })], { applications: [{ company: 'Acme', role: 'A' }, { company: 'Acme', role: 'B' }] }),
    );
    expect(apps.newApplications).toEqual([]);
    const open = [
      { id: 'app-1', company: 'Acme', role: 'A', applied_at: '2026-09-01T00:00:00.000Z' },
      { id: 'app-2', company: 'Acme', role: 'B', applied_at: '2026-09-01T00:00:00.000Z' },
    ];
    const opens = groupThreadRecords(input([rec({ role: '', status: 'rejected' })], { open }));
    expect(opens.findings).toEqual([]);
    expect(opens.newApplications).toEqual([]);
  });

  it('proposes a company with no thread that names a role as one application with the role "Not stated" (decision 12A)', () => {
    const confirmation = rec({ company: 'Globex', role: '', status: 'applied', first_date: '2026-10-02', date: '2026-10-02' });
    const rejection = rec({ company: 'globex', role: ' ', status: 'rejected', first_date: '2026-10-20', date: '2026-10-20' });
    const out = groupThreadRecords(input([confirmation, rejection]));
    expect(ROLE_NOT_STATED).toBe('Not stated');
    expect(out.newApplications).toHaveLength(1);
    expect(out.newApplications[0]).toMatchObject({ company: 'Globex', role: 'Not stated', status: 'rejected', applied_at: '2026-10-02' });
    expect(out.newApplications[0]!.thread_ids).toEqual([confirmation.thread_id, rejection.thread_id]);
    expect(out.logs).toEqual([]);
  });
});

describe('groupThreadRecords: review fixes', () => {
  it('names a new application after the thread that started earliest, not the one answered first (L1)', () => {
    const same = groupThreadRecords(input([rec({ company: 'acme', role: 'engineer', first_date: '2026-10-10', date: '2026-10-12' }), rec({ first_date: '2026-10-01', date: '2026-10-25' })]));
    expect(same.newApplications).toHaveLength(1);
    expect(same.newApplications[0]).toMatchObject({ company: 'Acme', role: 'Engineer', applied_at: '2026-10-01' });
  });

  it('logs an agent application id on one line (L2)', () => {
    const out = groupThreadRecords(input([rec({ application_id: 'app-x\nSaving results; the run can no longer be cancelled' })]));
    expect(out.logs).toEqual(['Ignoring an unknown application id from the agent: "app-x\\nSaving results; the run can no longer be cancelled"']);
  });

  it('keeps a finding for a known application even when the agent left the company blank (L4)', () => {
    const open = [{ id: 'app-1', company: 'Acme', role: 'Engineer', applied_at: '2026-09-01T00:00:00.000Z' }];
    const out = groupThreadRecords(input([rec({ application_id: 'app-1', company: '', status: 'offer', date: '2026-10-10' })], { open }));
    expect(out.findings.map((f) => [f.application_id, f.proposed_status])).toEqual([['app-1', 'offer']]);
  });
});

describe('groupThreadRecords: furthest stage wins (decision 13B)', () => {
  const open = [{ id: 'app-1', company: 'Acme', role: 'Engineer', applied_at: '2026-09-01T00:00:00.000Z' }];

  it('keeps an interview when a later thread only acknowledges the application', () => {
    const out = groupThreadRecords(
      input([rec({ application_id: 'app-1', status: 'interview', date: '2026-10-10' }), rec({ application_id: 'app-1', status: 'applied', date: '2026-10-12' })], { open }),
    );
    expect(out.findings.map((f) => f.proposed_status)).toEqual(['interview']);
  });

  it('lets a rejection win over a later interview, and uses the winning thread as evidence', () => {
    const rejection = rec({ status: 'rejected', date: '2026-10-05', reason: 'No' });
    const out = groupThreadRecords(input([rejection, rec({ status: 'interview', date: '2026-10-20' })]));
    expect(out.newApplications[0]).toMatchObject({ status: 'rejected', reason: 'No', evidence: rejection.evidence });
  });
});


describe('groupThreadRecords: aliases of merged applications (SOW-0055)', () => {
  const open = (over: Partial<GroupingInput['open'][number]> = {}) => ({
    id: 'app-1',
    company: 'Acme',
    role: 'Senior Engineer',
    applied_at: '2026-09-01T00:00:00.000Z',
    ...over,
  });

  it('gives a thread named by an alias to that open application', () => {
    const r = rec({ role: 'engineer (react)', status: 'interview' });
    const out = groupThreadRecords(input([r], { open: [open({ aliases: [{ company: 'Acme', role: 'Engineer (React)' }] })] }));
    expect(out.findings).toEqual([expect.objectContaining({ application_id: 'app-1', proposed_status: 'interview' })]);
    expect(out.newApplications).toEqual([]);
  });

  it('matches a thread without a role to an open application by an alias company', () => {
    const r = rec({ company: 'Acme Labs', role: '', status: 'screening' });
    const aliased = open({ aliases: [{ company: 'Acme Labs', role: 'Engineer' }] });
    const out = groupThreadRecords(input([r], { open: [aliased], applications: [aliased] }));
    expect(out.findings).toEqual([expect.objectContaining({ application_id: 'app-1', proposed_status: 'screening' })]);
  });

  it('matches a thread without a role to a closed application by an alias company', () => {
    const r = rec({ company: 'Acme Labs', role: '', status: 'rejected' });
    const closed = { company: 'Acme', role: 'Senior Engineer', aliases: [{ company: 'Acme Labs', role: 'Engineer' }] };
    const out = groupThreadRecords(input([r], { applications: [closed] }));
    expect(out.newApplications).toEqual([expect.objectContaining({ company: 'Acme', role: 'Senior Engineer', status: 'rejected' })]);
  });

  it('gives a thread to the application whose own name it is before one that has it as an alias', () => {
    const r = rec({ role: 'Dev', status: 'interview' });
    const aliased = open({ id: 'app-new', aliases: [{ company: 'Acme', role: 'Dev' }] });
    const own = open({ id: 'app-old', role: 'Dev' });
    const out = groupThreadRecords(input([r], { open: [aliased, own] }));
    expect(out.findings).toEqual([expect.objectContaining({ application_id: 'app-old' })]);
  });

  it('treats a thread under a name that is no alias as before', () => {
    const r = rec({ role: 'Engineer (React)', status: 'interview' });
    const out = groupThreadRecords(input([r], { open: [open()] }));
    expect(out.findings).toEqual([]);
    expect(out.newApplications).toEqual([expect.objectContaining({ role: 'Engineer (React)' })]);
  });
});
