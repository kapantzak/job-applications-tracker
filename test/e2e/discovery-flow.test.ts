import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startApp, type RunningApp } from '../../src/server/index.js';

const FIXTURE = resolve(import.meta.dirname, '../fixtures/fake-agent.mjs');
const q = (s: string) => `"${s}"`;

describe('discovery and sync flow over HTTP', () => {
  let tmp: string;
  let target: Server;
  let app: RunningApp;
  let savedMode: string | undefined;
  let savedOutput: string | undefined;

  beforeEach(async () => {
    savedMode = process.env.FAKE_AGENT_MODE;
    savedOutput = process.env.FAKE_AGENT_OUTPUT;
    tmp = mkdtempSync(join(tmpdir(), 'jobtrack-e2e-'));
    target = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>ok</html>');
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    app = await startApp({ dataDir: join(tmp, 'data'), port: 0, uiDir: null });
  });

  afterEach(async () => {
    await app?.close();
    await new Promise<void>((r) => target?.close(() => r()));
    rmSync(tmp, { recursive: true, force: true });
    if (savedMode === undefined) delete process.env.FAKE_AGENT_MODE;
    else process.env.FAKE_AGENT_MODE = savedMode;
    if (savedOutput === undefined) delete process.env.FAKE_AGENT_OUTPUT;
    else process.env.FAKE_AGENT_OUTPUT = savedOutput;
  });

  async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(app.url.replace(/\/$/, '') + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  async function waitForRun(id: string) {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const { body: run } = await api('GET', `/api/runs/${id}`);
      if (['succeeded', 'failed', 'aborted'].includes(run.status)) {
        expect(run.status, `run error: ${run.error}`).toBe('succeeded');
        return run;
      }
      if (Date.now() > deadline) throw new Error(`run ${id} stuck in ${run.status}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('discovers verified jobs, then applies a synced status proposal', async () => {
    const base = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
    const settings = await api('PATCH', '/api/settings', {
      adapter_id: 'custom',
      custom_command: `${q(process.execPath)} ${q(FIXTURE)} {prompt_file}`,
    });
    expect(settings.status).toBe(200);

    process.env.FAKE_AGENT_MODE = 'ok';
    process.env.FAKE_AGENT_OUTPUT = JSON.stringify({
      jobs: [
        { company: 'Acme Widgets', title: 'Platform Engineer', url: `${base}/acme/1`, location: 'Lisbon', remote: 'remote' },
        { company: 'Globex Labs', title: 'Backend Engineer', url: `${base}/globex/2`, location: 'Porto', remote: 'hybrid' },
      ],
      notes: '',
    });

    expect(
      (
        await api('PUT', '/api/profile', {
          target_roles: ['Platform Engineer'],
          locations: ['Lisbon'],
          remote: 'remote',
          seniority: 'senior',
          keywords: ['typescript'],
          excluded_companies: [],
          notes: 'invented profile',
        })
      ).status,
    ).toBe(200);

    const discover = await api('POST', '/api/runs/discover');
    expect(discover.status).toBe(202);
    const discovered = await waitForRun(discover.body.id);
    expect(discovered.adapter_id).toBe('custom');
    // A custom command carries its own flags; the app records no model or effort for it.
    expect([discovered.agent_model, discovered.agent_effort, discovered.agent_model_reported]).toEqual([null, null, null]);

    const jobs = await api<any[]>('GET', '/api/jobs');
    expect(jobs.body).toHaveLength(2);
    expect(jobs.body.map((j) => j.verification_status)).toEqual(['ok', 'ok']);

    const applied = await api('POST', `/api/jobs/${jobs.body[0].id}/applied`);
    expect(applied.status).toBe(201);
    const applicationId = applied.body.id;

    process.env.FAKE_AGENT_OUTPUT = JSON.stringify({
      mail_access: true,
      findings: [
        {
          application_id: applicationId,
          proposed_status: 'interview',
          confidence: 0.9,
          reason: 'Recruiter invited you to an interview',
          evidence: {
            message_id: 'msg-1',
            date: '2026-11-01',
            from: 'recruiter@acme.example',
            subject: 'Interview invitation',
            snippet: 'We would like to schedule an interview.',
          },
        },
      ],
      notes: '',
    });
    const sync = await api('POST', '/api/runs/sync');
    expect(sync.status).toBe(202);
    await waitForRun(sync.body.id);

    const proposals = await api<any[]>('GET', '/api/proposals');
    expect(proposals.body).toHaveLength(1);
    const accepted = await api('POST', `/api/proposals/${proposals.body[0].id}/accept`);
    expect(accepted.status).toBe(200);

    const detail = await api('GET', `/api/applications/${applicationId}`);
    expect(detail.body.status).toBe('interview');
    expect(detail.body.history).toHaveLength(1);
    expect(detail.body.history[0].source).toBe('proposal');
  }, 30_000);

  it('cancels a running discovery: the agent and its helper die and nothing is saved', async () => {
    expect(
      (
        await api('PATCH', '/api/settings', {
          adapter_id: 'custom',
          custom_command: `${q(process.execPath)} ${q(FIXTURE)} {prompt_file}`,
        })
      ).status,
    ).toBe(200);
    process.env.FAKE_AGENT_MODE = 'hang-tree';
    expect(
      (
        await api('PUT', '/api/profile', {
          target_roles: ['Platform Engineer'],
          locations: [],
          remote: 'any',
          seniority: '',
          keywords: [],
          excluded_companies: [],
          notes: '',
        })
      ).status,
    ).toBe(200);

    const discover = await api<{ id: string }>('POST', '/api/runs/discover');
    expect(discover.status).toBe(202);
    const pidFile = join(tmp, 'data', 'runs', discover.body.id, 'fake-agent.pid');
    const deadline = Date.now() + 10_000;
    while (!existsSync(pidFile)) {
      if (Date.now() > deadline) throw new Error('fake agent did not start');
      await new Promise((r) => setTimeout(r, 20));
    }
    // hang-tree writes the agent pid, then its helper's pid.
    let pids: number[] = [];
    while (pids.length < 2) {
      pids = readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number);
      if (Date.now() > deadline) throw new Error('fake agent did not start its helper');
      if (pids.length < 2) await new Promise((r) => setTimeout(r, 20));
    }
    const isAlive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(pids.every(isAlive)).toBe(true);

    try {
      const cancel = await api('POST', `/api/runs/${discover.body.id}/cancel`);
      expect(cancel.status).toBe(202);
      let run: any;
      for (;;) {
        run = (await api('GET', `/api/runs/${discover.body.id}`)).body;
        if (run.status !== 'running') break;
        if (Date.now() > deadline + 10_000) throw new Error('run was not stopped');
        await new Promise((r) => setTimeout(r, 50));
      }
      expect([run.status, run.error]).toEqual(['aborted', 'Cancelled by user']);
      // The helper is reparented when the agent dies; give the group signal a moment to land.
      const killDeadline = Date.now() + 5000;
      while (pids.some(isAlive) && Date.now() < killDeadline) await new Promise((r) => setTimeout(r, 20));
      expect(pids.filter(isAlive)).toEqual([]);
      expect((await api<unknown[]>('GET', '/api/jobs')).body).toEqual([]);
    } finally {
      // Never leave a 60 s sleeper behind if an assertion above fails.
      for (const pid of pids.filter(isAlive)) process.kill(pid, 'SIGKILL');
    }
  }, 30_000);
});
