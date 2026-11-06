import { describe, expect, it } from 'vitest';
import { DiscoverJobsOutput, SyncMailOutput, outputJsonSchema } from '../../../src/server/tasks/schemas.js';

const job = { company: 'Acme', title: 'Dev', url: 'https://acme.test/1' };

describe('task schemas', () => {
  it('accepts a valid discover sample and applies defaults', () => {
    const r = DiscoverJobsOutput.parse({ jobs: [job] });
    expect(r.jobs[0]).toMatchObject({ remote: 'unknown', posted_at: null, salary: null, location: '' });
    expect(r.notes).toBe('');
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

  it('json schema for sync_mail requires mail_access', () => {
    const s = outputJsonSchema('sync_mail');
    expect(s.required).toContain('mail_access');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
