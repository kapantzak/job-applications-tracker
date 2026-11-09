import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentResult, AgentTask } from '../../../src/server/agents/types.js';
import type { AgentRunRecord } from '../../../src/server/db/runs-repo.js';
import { createAgentMailSource } from '../../../src/server/mail/agent-source.js';
import { MailAccessError, type MailSyncRequest } from '../../../src/server/mail/types.js';

const req: MailSyncRequest = {
  applications: [
    { id: 'app-1', company: 'Acme', role: 'Engineer', applied_at: '2026-01-01', sender_domains: ['acme.example.com'] },
    { id: 'app-2', company: 'Globex', role: 'Dev', applied_at: '2026-01-02', sender_domains: [] },
  ],
  reviewed_message_ids: ['msg-001', 'msg-002'],
  mail_scope: null,
};

function ctx() {
  const logs: string[] = [];
  const records: AgentRunRecord[] = [];
  return {
    logs,
    records,
    c: {
      log: (l: string) => logs.push(l),
      signal: new AbortController().signal,
      runDir: mkdtempSync(join(tmpdir(), 'mail-')),
      timeoutMs: 1000,
      recordAgent: (r: AgentRunRecord) => records.push(r),
    },
  };
}

function stub(result: AgentResult, tasks: AgentTask[] = [], overrides: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    id: 'custom',
    check: async () => ({ id: 'custom', installed: true }),
    listModels: async () => ({ source: 'unavailable', models: [], efforts: [] }),
    run: async (task) => {
      tasks.push(task);
      return result;
    },
    ...overrides,
  };
}

function ok(output: unknown): AgentResult {
  return { ok: true, output, rawStdout: '', rawStderr: '', exitCode: 0, durationMs: 1 };
}

describe('agent mail source', () => {
  it('records the requested selection before the run and the reported model after, even on failure', async () => {
    const failed: AgentResult = { ...ok({}), ok: false, error: 'Timed out after 1000 ms', reportedModel: 'model-a' };
    const source = createAgentMailSource(stub(failed, [], { id: 'codex', selection: { model: 'model-x', effort: 'high' } }));
    const { records, logs, c } = ctx();
    await expect(source.sync(req, c)).rejects.toThrow('Agent run failed: Timed out after 1000 ms');
    expect(records).toEqual([
      { adapter_id: 'codex', agent_model: 'model-x', agent_effort: 'high' },
      { agent_model_reported: 'model-a' },
    ]);
    expect(logs).toContain('Model: model-x, effort: high');
  });

  it('rejects with MailAccessError when mail_access is false', async () => {
    const source = createAgentMailSource(stub(ok({ mail_access: false, findings: [] })));
    const p = source.sync(req, ctx().c);
    await expect(p).rejects.toBeInstanceOf(MailAccessError);
    await expect(p).rejects.toThrow('Your agent has no Gmail tool. See the setup guide in Settings.');
  });

  it('puts reviewed message ids and applications into the prompt', async () => {
    const tasks: AgentTask[] = [];
    const source = createAgentMailSource(stub(ok({ mail_access: true, findings: [] }), tasks));
    const { logs, c } = ctx();
    const res = await source.sync(req, c);
    expect(res.findings).toEqual([]);
    expect(res.promptVersion).toBeTruthy();
    expect(res.adapterId).toBe('custom');
    expect(tasks[0]?.kind).toBe('sync_mail');
    expect(tasks[0]?.prompt).toContain('msg-001, msg-002');
    expect(tasks[0]?.prompt).toContain(
      '- id: app-1 | company: Acme | role: Engineer | applied_at: 2026-01-01 | sender_domains: acme.example.com',
    );
    expect(tasks[0]?.prompt).toContain('sender_domains: (none)');
    expect(logs).toContain('Using adapter custom');
  });

  it('keeps the company and ATS sender search when the profile has no scope', async () => {
    const tasks: AgentTask[] = [];
    const source = createAgentMailSource(stub(ok({ mail_access: true, findings: [] }), tasks));
    await source.sync(req, ctx().c);
    expect(tasks[0]?.prompt).toContain(
      '## Mailbox scope\n\nNo scope is set. Search only messages from the listed companies and the ATS domains above.\n',
    );
  });

  it('puts the profile scope on a line of its own', async () => {
    const tasks: AgentTask[] = [];
    const source = createAgentMailSource(stub(ok({ mail_access: true, findings: [] }), tasks));
    await source.sync({ ...req, mail_scope: 'label:Jobs-Frontend OR to:you+frontend@example.com' }, ctx().c);
    const prompt = tasks[0]?.prompt ?? '';
    expect(prompt).toContain(
      'Search only messages that match this Gmail search query, copied exactly as written:\n\nlabel:Jobs-Frontend OR to:you+frontend@example.com\n\n',
    );
    expect(prompt).toContain('wrap the query in parentheses first');
    expect(prompt).not.toContain('No scope is set.');
  });

  it('renders (none) when nothing was reviewed', async () => {
    const tasks: AgentTask[] = [];
    const source = createAgentMailSource(stub(ok({ mail_access: true, findings: [] }), tasks));
    await source.sync({ ...req, reviewed_message_ids: [] }, ctx().c);
    expect(tasks[0]?.prompt).toContain('(none)');
  });

  it('throws when the agent run fails', async () => {
    const failed: AgentResult = { ok: false, error: 'boom', rawStdout: '', rawStderr: '', exitCode: 1, durationMs: 1 };
    await expect(createAgentMailSource(stub(failed)).sync(req, ctx().c)).rejects.toThrow('Agent run failed: boom');
  });

  it('throws when output does not match the schema', async () => {
    const source = createAgentMailSource(stub(ok({ mail_access: true, findings: [{ application_id: 'app-1' }] })));
    await expect(source.sync(req, ctx().c)).rejects.toThrow(/Agent output did not match schema: findings\.0\./);
  });
});
