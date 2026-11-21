import { describe, expect, it } from 'vitest';
import { DiscoverJobsOutput, SyncMailListOutput, SyncMailOutput, SyncMailReadOutput, ThreadRecord, outputJsonSchema } from '../../../src/server/tasks/schemas.js';

const job = { company: 'Acme', title: 'Dev', url: 'https://acme.test/1' };

describe('task schemas', () => {
  it('accepts a valid discover sample and applies defaults', () => {
    const r = DiscoverJobsOutput.parse({ jobs: [job] });
    expect(r.jobs[0]).toMatchObject({ remote: 'unknown', posted_at: null, salary: null, location: '' });
    expect(r.notes).toBe('');
  });

  it('defaults missing fit checks to unknown and keeps given ones', () => {
    const r = DiscoverJobsOutput.parse({
      jobs: [job, { ...job, url: 'https://acme.test/2', checks: { location: 'pass', remote: 'fail' } }],
    });
    expect(r.jobs[0]!.checks).toEqual({ location: 'unknown', remote: 'unknown', seniority: 'unknown' });
    expect(r.jobs[1]!.checks).toEqual({ location: 'pass', remote: 'fail', seniority: 'unknown' });
  });

  it('rejects a fit verdict outside pass, fail and unknown', () => {
    expect(() => DiscoverJobsOutput.parse({ jobs: [{ ...job, checks: { location: 'maybe' } }] })).toThrow(/location/);
  });

  it('rejects a job without url', () => {
    expect(() => DiscoverJobsOutput.parse({ jobs: [{ company: 'A', title: 'B' }] })).toThrow();
  });

  it('rejects sync payload missing mail_access', () => {
    expect(() => SyncMailOutput.parse({ findings: [] })).toThrow();
  });

  it('rejects confidence out of range', () => {
    const f = { application_id: 'a', proposed_status: 'offer', confidence: 2, reason: '',
      evidence: { message_id: 'm', date: '', from: '', subject: '', snippet: '' } };
    expect(() => SyncMailOutput.parse({ mail_access: true, findings: [f] })).toThrow();
  });

  it('sync_mail scope_message_count is a count or null, and null when missing', () => {
    expect(SyncMailOutput.parse({ mail_access: true, findings: [] }).scope_message_count).toBeNull();
    expect(SyncMailOutput.parse({ mail_access: true, findings: [], scope_message_count: 0 }).scope_message_count).toBe(0);
    expect(() => SyncMailOutput.parse({ mail_access: true, findings: [], scope_message_count: -1 })).toThrow();
    expect(() => SyncMailOutput.parse({ mail_access: true, findings: [], scope_message_count: 1.5 })).toThrow();
  });

  it('sync_mail new_applications defaults to an empty list and validates each entry', () => {
    expect(SyncMailOutput.parse({ mail_access: true, findings: [] }).new_applications).toEqual([]);
    const entry = {
      company: 'Acme',
      role: 'Engineer',
      status: 'interview',
      applied_at: '2026-01-05',
      sender_domain: '',
      confidence: 0.8,
      reason: 'Invited to an interview',
      evidence: { message_id: 'msg-001', date: '2026-01-09', from: 'jobs@acme.example.com', subject: 'S', snippet: 'N' },
    };
    expect(SyncMailOutput.parse({ mail_access: true, findings: [], new_applications: [entry] }).new_applications).toEqual([entry]);
    const { sender_domain: _omitted, ...withoutDomain } = entry;
    expect(SyncMailOutput.parse({ mail_access: true, findings: [], new_applications: [withoutDomain] }).new_applications[0]?.sender_domain).toBe('');
    expect(() => SyncMailOutput.parse({ mail_access: true, findings: [], new_applications: [{ ...entry, status: 'no_change' }] })).toThrow();
    expect(() => SyncMailOutput.parse({ mail_access: true, findings: [], new_applications: [{ ...entry, confidence: 2 }] })).toThrow();
  });

  it('json schema for sync_mail requires mail_access', () => {
    const s = outputJsonSchema('sync_mail');
    expect(s.required).toContain('mail_access');
    expect(s.required).toContain('scope_message_count');
    expect(s.required).toContain('new_applications');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('sync_mail list and read schemas', () => {
  const evidence = { message_id: 'msg-001', date: '2026-11-02', from: 'hr@acme.example.com', subject: 'Interview', snippet: 'Pick a slot' };
  const record = {
    thread_id: 'thr-001',
    application_id: '',
    company: 'Acme',
    role: 'Engineer',
    status: 'interview',
    first_date: '2026-10-20',
    sender_domain: 'acme.example.com',
    confidence: 0.9,
    reason: 'Interview invitation',
    evidence,
  };

  it('list output carries windows and threads, with notes defaulting to empty', () => {
    const out = SyncMailListOutput.parse({
      mail_access: true,
      windows: [{ after: '', before: '2026/11/01', thread_count: 12 }],
      threads: [{ thread_id: 'thr-001', last_message_id: 'msg-009' }],
    });
    expect(out.notes).toBe('');
    expect(() => SyncMailListOutput.parse({ mail_access: true, windows: [{ after: '', before: '', thread_count: -1 }], threads: [] })).toThrow();
  });

  it('read records take the new-application stages, with application_id and sender_domain defaulting to empty', () => {
    const { application_id: _a, sender_domain: _s, ...bare } = record;
    expect(ThreadRecord.parse(bare)).toMatchObject({ application_id: '', sender_domain: '' });
    expect(() => ThreadRecord.parse({ ...record, status: 'no_change' })).toThrow();
    expect(() => ThreadRecord.parse({ ...record, confidence: 1.5 })).toThrow();
    expect(SyncMailReadOutput.parse({ mail_access: true, threads: [record] }).not_applications).toEqual([]);
  });

  it('json schemas require every field the app reads', () => {
    const list = outputJsonSchema('sync_mail_list') as any;
    expect(list.required).toEqual(['mail_access', 'windows', 'threads', 'notes']);
    expect(list.properties.windows.items.required).toEqual(['after', 'before', 'thread_count']);
    expect(list.properties.threads.items.required).toEqual(['thread_id', 'last_message_id']);
    const read = outputJsonSchema('sync_mail_read') as any;
    expect(read.required).toEqual(['mail_access', 'threads', 'not_applications', 'notes']);
    expect(read.properties.threads.items.required).toEqual([
      'thread_id', 'application_id', 'company', 'role', 'status', 'first_date', 'sender_domain', 'confidence', 'reason', 'evidence',
    ]);
  });
});

// Claude Code rejects a draft-2020-12 `$schema` pointer; the OpenAI structured-output API behind
// Codex requires `additionalProperties: false` and every property in `required`.
function assertAgentCompatible(node: unknown, path = '$'): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => assertAgentCompatible(n, `${path}[${i}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  expect(o, `${path} has $schema`).not.toHaveProperty('$schema');
  expect(o, `${path} has default`).not.toHaveProperty('default');
  if (o.type === 'object' && o.properties) {
    expect(o.additionalProperties, `${path}.additionalProperties`).toBe(false);
    expect(o.required, `${path}.required`).toEqual(Object.keys(o.properties as object));
  }
  for (const [k, v] of Object.entries(o)) assertAgentCompatible(v, `${path}.${k}`);
}

describe('agent-compatible json schema', () => {
  it.each(['discover_jobs', 'sync_mail', 'sync_mail_list', 'sync_mail_read', 'analyse_cv'] as const)('%s schema is strict and carries no $schema pointer', (kind) => {
    assertAgentCompatible(outputJsonSchema(kind));
  });

  it('discover_jobs schema still requires the url to be non-empty', () => {
    const s = outputJsonSchema('discover_jobs') as any;
    expect(s.properties.jobs.items.properties.url).toMatchObject({ type: 'string', minLength: 1 });
    expect(s.properties.jobs.items.properties.posted_at).toEqual({ type: ['string', 'null'] });
  });

  it('discover_jobs schema asks for a verdict on each must-have', () => {
    const checks = (outputJsonSchema('discover_jobs') as any).properties.jobs.items.properties.checks;
    expect(checks.required).toEqual(['location', 'remote', 'seniority']);
    expect(checks.properties.remote).toEqual({ type: 'string', enum: ['pass', 'fail', 'unknown'] });
  });

  it('analyse_cv schema asks for every profile field the CV can fill, and never excluded companies', () => {
    const s = outputJsonSchema('analyse_cv') as any;
    expect(s.required).toEqual(['name', 'target_roles', 'locations', 'remote', 'seniority', 'keywords', 'notes']);
    expect(s.properties.remote).toEqual({ type: 'string', enum: ['remote', 'hybrid', 'onsite', 'any'] });
    expect(s.properties.seniority).toEqual({ type: 'array', items: { type: 'string' } });
  });
});
