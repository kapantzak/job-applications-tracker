import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockAgentCommand } from '../../../scripts/sandbox-mock/seed.js';
import { createAdapter } from '../../../src/server/agents/index.js';
import { DEFAULT_SETTINGS } from '../../../src/server/db/settings-repo.js';
import { createAgentMailSource } from '../../../src/server/mail/agent-source.js';
import type { MailSyncRequest } from '../../../src/server/mail/types.js';
import { SENIORITY_LEVELS } from '../../../src/server/domain/seniority.js';
import type { AgentTaskKind } from '../../../src/server/domain/types.js';
import { DEFAULT_SCOPE } from '../../../src/server/services/discovery.js';
import { renderPrompt } from '../../../src/server/tasks/prompts.js';
import { AnalyseCvOutput, DiscoverJobsOutput, outputJsonSchema } from '../../../src/server/tasks/schemas.js';

const SCRIPT = fileURLToPath(new URL('../../../scripts/sandbox-mock/mock-agent.mjs', import.meta.url));

// Goes through the real custom adapter, so the placeholder and stdout JSON paths are covered too.
describe('mock agent', () => {
  let cwd: string;
  const settings = {
    ...DEFAULT_SETTINGS,
    adapter_id: 'custom' as const,
    custom_command: mockAgentCommand(process.execPath, SCRIPT, { delayMs: 0 }),
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'jobtrack-mock-agent-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  async function run(kind: AgentTaskKind, vars: Record<string, unknown>) {
    const adapter = createAdapter(settings, kind);
    const logs: string[] = [];
    const result = await adapter.run(
      { kind, prompt: renderPrompt(kind, vars).text, outputSchema: outputJsonSchema(kind) },
      { timeoutMs: 10_000, cwd, onLog: (line) => logs.push(line) },
    );
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    return { output: result.output, logs };
  }

  // A custom command's check runs "<argv0> --version", which here is node itself.
  it('passes the custom agent health check with node as the command', async () => {
    const health = await createAdapter(settings, 'discover_jobs').check();
    expect(health).toMatchObject({ id: 'custom', installed: true, version: process.version });
  });

  it('returns discovery jobs with one live and one closed link shape, unique per call', async () => {
    const vars = { profile: 'Target roles: Frontend Engineer', known_urls: '(none)', scope: DEFAULT_SCOPE, custom_prompt: '(none)' };
    const first = DiscoverJobsOutput.parse((await run('discover_jobs', vars)).output);
    const second = DiscoverJobsOutput.parse((await run('discover_jobs', vars)).output);
    expect(first.jobs.length).toBeGreaterThanOrEqual(4);
    expect(first.jobs.some((j) => j.url.startsWith('https://example.com/?mock-job='))).toBe(true);
    expect(first.jobs.some((j) => j.url.startsWith('https://example.com/mock-closed/'))).toBe(true);
    const firstUrls = new Set(first.jobs.map((j) => j.url));
    expect(second.jobs.some((j) => firstUrls.has(j.url))).toBe(false);
  });

  // A real agent sometimes ignores the list, which lets a live sandbox search find a known job again (SOW-0041).
  it('repeats the newest known url once and nothing else from the list', async () => {
    const known = ['https://example.com/?mock-job=seed-20', 'https://example.com/?mock-job=seed-19'];
    const vars = { profile: 'Target roles: Backend Engineer', known_urls: known.join('\n'), scope: DEFAULT_SCOPE, custom_prompt: '(none)' };
    const { jobs } = DiscoverJobsOutput.parse((await run('discover_jobs', vars)).output);
    expect(jobs.filter((j) => j.url === known[0])).toHaveLength(1);
    expect(jobs.some((j) => j.url === known[1])).toBe(false);
  });

  // Through the app's own mail source, so a change to how it lists applications in the prompt fails here.
  async function sync(applications: MailSyncRequest['applications'], mailScope: string | null = 'label:Jobs-Frontend') {
    const logs: string[] = [];
    const findings = await createAgentMailSource(createAdapter(settings, 'sync_mail')).sync(
      { applications, reviewed_message_ids: ['msg-001'], mail_scope: mailScope },
      { log: (line) => logs.push(line), signal: new AbortController().signal, runDir: cwd, timeoutMs: 10_000, recordAgent: () => {} },
    );
    return { findings, logs };
  }

  it('proposes changes only for applications listed in the prompt', async () => {
    const { findings, logs } = await sync([
      { id: 'app-001', company: 'Acme', role: 'Engineer', applied_at: '2026-10-01', sender_domains: ['acme.example.com'] },
      { id: 'app-002', company: 'Globex', role: 'Developer', applied_at: '2026-10-02', sender_domains: [] },
      { id: 'app-003', company: 'Initech', role: 'Designer', applied_at: '2026-10-03', sender_domains: [] },
    ]);
    expect(findings.findings.map((f) => [f.application_id, f.proposed_status])).toEqual([
      ['app-001', 'interview'],
      ['app-002', 'rejected'],
      ['app-003', 'no_change'],
    ]);
    expect(findings.findings.some((f) => f.evidence.message_id === 'msg-001')).toBe(false);
    expect(logs.some((l) => l.includes('mock agent'))).toBe(true);
  });

  it('reports a scope count only when the prompt carries a scope', async () => {
    const app = { id: 'app-001', company: 'Acme', role: 'Engineer', applied_at: '2026-10-01', sender_domains: [] };
    expect((await sync([app])).findings.scope_message_count).toBe(1);
    expect((await sync([app], null)).findings.scope_message_count).toBeNull();
  });

  it('reports a zero count and no changes when the scope contains nomatch', async () => {
    const apps = [
      { id: 'app-001', company: 'Acme', role: 'Engineer', applied_at: '2026-10-01', sender_domains: [] },
      { id: 'app-002', company: 'Globex', role: 'Developer', applied_at: '2026-10-02', sender_domains: [] },
    ];
    const { findings } = await sync(apps, 'label:NoMatch');
    expect(findings.scope_message_count).toBe(0);
    expect(findings.findings.map((f) => f.proposed_status)).toEqual(['no_change', 'no_change']);
  });

  it('returns no findings when there are no applications', async () => {
    const { findings } = await sync([]);
    expect(findings.findings).toEqual([]);
  });

  it('prints its result as one log line, so the Run page summarises it', async () => {
    const { logs } = await run('discover_jobs', { profile: '(none)', known_urls: '(none)', scope: DEFAULT_SCOPE, custom_prompt: '(none)' });
    const json = logs.filter((l) => l.trim().startsWith('{'));
    expect(json).toHaveLength(1);
    expect(DiscoverJobsOutput.parse(JSON.parse(json[0]!)).jobs.length).toBeGreaterThan(0);
  });

  it('drafts a profile from a CV', async () => {
    const { output } = await run('analyse_cv', {
      cv_text: 'Alex Example\nBackend Engineer',
      seniority_levels: SENIORITY_LEVELS.join(', '),
    });
    const draft = AnalyseCvOutput.parse(output);
    expect(draft.name).toMatch(/^[A-Za-z0-9 ]{1,40}$/);
    expect(draft.target_roles.length).toBeGreaterThan(0);
  });
});
