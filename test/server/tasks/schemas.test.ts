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
  it.each(['discover_jobs', 'sync_mail'] as const)('%s schema is strict and carries no $schema pointer', (kind) => {
    assertAgentCompatible(outputJsonSchema(kind));
  });

  it('discover_jobs schema still requires the url to be non-empty', () => {
    const s = outputJsonSchema('discover_jobs') as any;
    expect(s.properties.jobs.items.properties.url).toMatchObject({ type: 'string', minLength: 1 });
    expect(s.properties.jobs.items.properties.posted_at).toEqual({ type: ['string', 'null'] });
  });
});
