import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentResult, AgentTask } from '../../../src/server/agents/types.js';
import { createAgentMailSource } from '../../../src/server/mail/agent-source.js';
import { MailAccessError, type MailSyncRequest } from '../../../src/server/mail/types.js';

const req: MailSyncRequest = {
  applications: [
    { id: 'app-1', company: 'Acme', role: 'Engineer', applied_at: '2026-01-01', sender_domains: ['acme.example.com'] },
    { id: 'app-2', company: 'Globex', role: 'Dev', applied_at: '2026-01-02', sender_domains: [] },
  ],
  reviewed_message_ids: ['msg-001', 'msg-002'],
};

function ctx() {
  const logs: string[] = [];
  return {
    logs,
    c: {
      log: (l: string) => logs.push(l),
      signal: new AbortController().signal,
      runDir: mkdtempSync(join(tmpdir(), 'mail-')),
      timeoutMs: 1000,
    },
  };
}

function stub(result: AgentResult, tasks: AgentTask[] = []): AgentAdapter {
  return {
    id: 'custom',
    check: async () => ({ id: 'custom', installed: true }),
    run: async (task) => {
      tasks.push(task);
      return result;
    },
  };
}

function ok(output: unknown): AgentResult {
  return { ok: true, output, rawStdout: '', rawStderr: '', exitCode: 0, durationMs: 1 };
}

describe('agent mail source', () => {
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
