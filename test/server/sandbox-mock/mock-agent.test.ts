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
import { groupThreadRecords } from '../../../src/server/domain/thread-grouping.js';
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
  async function sync(
    applications: MailSyncRequest['applications'],
    mailScope: string | null = 'label:Jobs-Frontend',
    tracked: MailSyncRequest['tracked'] = [],
    known: Map<string, string> = new Map(),
  ) {
    const logs: string[] = [];
    const findings = await createAgentMailSource(createAdapter(settings, 'sync_mail')).sync(
      {
        applications,
        reviewed_message_ids: ['msg-001'],
        mail_scope: mailScope,
        new_applications_since: '2026/08/13',
        tracked,
        known_threads: known,
        today: '2026/11/20',
        list_since: null,
      },
      {
        log: (line) => logs.push(line),
        signal: new AbortController().signal,
        runDir: cwd,
        timeoutMs: 10_000,
        recordAgent: () => {},
        recordUsage: () => {},
      },
    );
    // A scoped sync returns per-thread records; group them as the handler does (SOW-0051).
    const grouped = groupThreadRecords({ records: findings.threads?.records ?? [], open: applications, applications: [] });
    return { findings, grouped, logs };
  }

  const threeApps = [
    { id: 'app-001', company: 'Acme', role: 'Engineer', applied_at: '2026-10-01', sender_domains: ['acme.example.com'], aliases: [] },
    { id: 'app-002', company: 'Globex', role: 'Developer', applied_at: '2026-10-02', sender_domains: [], aliases: [] },
    { id: 'app-003', company: 'Initech', role: 'Designer', applied_at: '2026-10-03', sender_domains: [], aliases: [] },
  ];

  it('without a scope, proposes changes only for applications listed in the prompt', async () => {
    const { findings, logs } = await sync(threeApps, null);
    expect(findings.findings.map((f) => [f.application_id, f.proposed_status])).toEqual([
      ['app-001', 'interview'],
      ['app-002', 'rejected'],
      ['app-003', 'no_change'],
    ]);
    expect(findings.findings.some((f) => f.evidence.message_id === 'msg-001')).toBe(false);
    expect(findings.scope_message_count).toBeNull();
    expect(logs.some((l) => l.includes('mock agent'))).toBe(true);
  });

  // Merged applications list their other names after the role (SOW-0055); the mock must still read the line.
  it('reads application lines that carry also-known-as names, with and without a scope', async () => {
    const aliased = threeApps.map((a) => ({
      ...a,
      aliases: [
        { company: a.company, role: `${a.role} (Remote)` },
        { company: `${a.company} Labs`, role: 'Contractor' },
      ],
    }));
    const plain = await sync(threeApps, null);
    expect((await sync(aliased, null)).findings.findings.map((f) => [f.application_id, f.proposed_status])).toEqual(
      plain.findings.findings.map((f) => [f.application_id, f.proposed_status]),
    );
    const scopedPlain = await sync(threeApps);
    const scopedAliased = await sync(aliased);
    expect(scopedAliased.grouped.findings.map((f) => [f.application_id, f.proposed_status])).toEqual(
      scopedPlain.grouped.findings.map((f) => [f.application_id, f.proposed_status]),
    );
    // The mock replies with the company and role it read from the line, so a misread shows here.
    const names = (r: typeof scopedPlain) => r.findings.threads?.records.map((t) => [t.application_id, t.company, t.role]);
    expect(names(scopedAliased)).toEqual(names(scopedPlain));
  });

  it('without a scope, leaves out new applications the prompt lists as open or tracked', async () => {
    const listed = { id: 'app-001', company: 'Contoso Pharma', role: 'Frontend Engineer', applied_at: '2026-10-01', sender_domains: [], aliases: [] };
    expect((await sync([listed], null)).findings.new_applications.map((a) => a.company)).toEqual(['Fabrikam Games']);
    const tracked = [{ company: 'fabrikam games', role: 'UI Developer' }];
    expect((await sync([], null, tracked)).findings.new_applications.map((a) => a.company)).toEqual(['Contoso Pharma']);
  });

  it('with a scope, lists threads, reads them in a batch and replies to the first two open applications', async () => {
    const { findings, grouped, logs } = await sync(threeApps);
    expect(findings.threads?.listed).toBe(5);
    expect(findings.threads?.uncovered).toEqual([]);
    expect(findings.threads?.batches).toEqual({ total: 1, failed: 0 });
    expect(findings.threads?.read).toHaveLength(5);
    expect(grouped.findings.map((f) => [f.application_id, f.proposed_status])).toEqual([
      ['app-001', 'interview'],
      ['app-002', 'rejected'],
    ]);
    expect(grouped.newApplications.map((a) => [a.company, a.status])).toEqual([
      ['Contoso Pharma', 'applied'],
      ['Fabrikam Games', 'screening'],
    ]);
    expect(logs).toContain('Listed 5 threads');
    expect(logs.some((l) => l.startsWith('[batch 1] mock agent: '))).toBe(true);
  });

  // A labelled profile without applications (the seeded Backend Engineering) must not read as a scope miss.
  it('with a scope, counts the listed threads, also with no open application', async () => {
    const { findings, grouped } = await sync([], 'label:Jobs-Backend');
    expect(findings.scope_message_count).toBe(5);
    expect(grouped.findings).toEqual([]);
    expect(grouped.newApplications.map((a) => a.company)).toEqual(['Contoso Pharma', 'Fabrikam Games']);
  });

  it('matches a listed open application by name, so it is not proposed as new', async () => {
    const listed = { id: 'app-001', company: 'Contoso Pharma', role: 'Frontend Engineer', applied_at: '2026-10-01', sender_domains: [], aliases: [] };
    const { grouped } = await sync([listed]);
    expect(grouped.newApplications.map((a) => a.company)).toEqual(['Fabrikam Games']);
  });

  it('lists nothing when the scope contains nomatch', async () => {
    const { findings, grouped } = await sync(threeApps, 'label:NoMatch');
    expect(findings.scope_message_count).toBe(0);
    expect(findings.threads?.batches.total).toBe(0);
    expect(grouped.findings).toEqual([]);
    expect(grouped.newApplications).toEqual([]);
  });

  it('reads nothing on a second sync, since every thread is unchanged', async () => {
    const first = await sync(threeApps);
    const known = new Map(first.findings.threads!.read.map((r) => [r.thread_id, r.last_message_id]));
    const second = await sync(threeApps, 'label:Jobs-Frontend', [], known);
    expect(second.findings.threads?.batches.total).toBe(0);
    expect(second.logs).toContain('No new or changed threads to read');
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

// The demo video (SOW-0048) shows agent text on screen, so --demo must keep the shapes and drop "mock".
describe('mock agent --demo', () => {
  let cwd: string;
  const settings = {
    ...DEFAULT_SETTINGS,
    adapter_id: 'custom' as const,
    custom_command: mockAgentCommand(process.execPath, SCRIPT, { delayMs: 0, demo: true }),
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'jobtrack-mock-demo-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  async function run(kind: AgentTaskKind, vars: Record<string, unknown>) {
    const logs: string[] = [];
    const result = await createAdapter(settings, kind).run(
      { kind, prompt: renderPrompt(kind, vars).text, outputSchema: outputJsonSchema(kind) },
      { timeoutMs: 10_000, cwd, onLog: (line) => logs.push(line) },
    );
    expect(result.ok).toBe(true);
    return { output: result.output, logs };
  }

  const noMock = (text: string) => expect(text).not.toMatch(/mock/i);

  it('returns jobs and progress lines without mock wording, except the links', async () => {
    const vars = { profile: 'Target roles: Frontend Engineer', known_urls: '(none)', scope: DEFAULT_SCOPE, custom_prompt: '(none)' };
    const { output, logs } = await run('discover_jobs', vars);
    const { jobs, notes } = DiscoverJobsOutput.parse(output);
    expect(jobs.length).toBeGreaterThanOrEqual(4);
    for (const job of jobs) noMock(JSON.stringify({ ...job, url: '' }));
    noMock(notes ?? '');
    for (const line of logs.filter((l) => !l.trim().startsWith('{'))) noMock(line);
  });

  it('drafts a profile without mock wording', async () => {
    const { output } = await run('analyse_cv', { cv_text: 'Sam Placeholder', seniority_levels: SENIORITY_LEVELS.join(', ') });
    const draft = AnalyseCvOutput.parse(output);
    expect(draft.name).toMatch(/^[A-Za-z0-9 ]{1,40}$/);
    noMock(JSON.stringify(draft));
  });

  it('reports replies and new applications without mock wording, except message ids', async () => {
    const logs: string[] = [];
    const findings = await createAgentMailSource(createAdapter(settings, 'sync_mail')).sync(
      {
        applications: [{ id: 'app-001', company: 'Acme', role: 'Engineer', applied_at: '2026-10-01', sender_domains: [], aliases: [] }],
        reviewed_message_ids: [],
        mail_scope: null,
        new_applications_since: '2026/08/13',
        tracked: [],
        known_threads: new Map(),
        today: '2026/11/20',
        list_since: null,
      },
      {
        log: (line) => logs.push(line),
        signal: new AbortController().signal,
        runDir: cwd,
        timeoutMs: 10_000,
        recordAgent: () => {},
        recordUsage: () => {},
      },
    );
    expect(findings.findings.map((f) => f.proposed_status)).toEqual(['interview']);
    expect(findings.new_applications).toHaveLength(2);
    const strip = (e: { message_id: string }) => ({ ...e, message_id: '' });
    for (const f of findings.findings) noMock(JSON.stringify({ ...f, evidence: strip(f.evidence) }));
    for (const a of findings.new_applications) noMock(JSON.stringify({ ...a, evidence: strip(a.evidence) }));
    noMock(findings.notes ?? '');
  });

  it('lists and reads a scope without mock wording, except ids', async () => {
    const logs: string[] = [];
    const findings = await createAgentMailSource(createAdapter(settings, 'sync_mail')).sync(
      {
        applications: [{ id: 'app-001', company: 'Acme', role: 'Engineer', applied_at: '2026-10-01', sender_domains: [], aliases: [] }],
        reviewed_message_ids: [],
        mail_scope: 'label:Jobs-Frontend',
        new_applications_since: '2026/08/13',
        tracked: [],
        known_threads: new Map(),
        today: '2026/11/20',
        list_since: null,
      },
      {
        log: (line) => logs.push(line),
        signal: new AbortController().signal,
        runDir: cwd,
        timeoutMs: 10_000,
        recordAgent: () => {},
        recordUsage: () => {},
      },
    );
    const records = findings.threads?.records ?? [];
    expect(records.length).toBe(3);
    for (const r of records) noMock(JSON.stringify({ ...r, thread_id: '', evidence: { ...r.evidence, message_id: '' } }));
    for (const line of logs.filter((l) => !l.includes('{'))) noMock(line.replace(/\[(list|batch) \d+\] /, ''));
  });
});
