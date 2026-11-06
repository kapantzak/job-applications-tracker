import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCliAdapter } from '../../../src/server/agents/cli-adapter.js';
import { createAdapter } from '../../../src/server/agents/index.js';
import { buildAdapterConfig } from '../../../src/server/agents/presets.js';
import type { ResolveDeps } from '../../../src/server/agents/resolve-command.js';
import type { AgentTask, CliAdapterConfig } from '../../../src/server/agents/types.js';
import { DEFAULT_SETTINGS } from '../../../src/server/db/settings-repo.js';

const FIXTURE = fileURLToPath(new URL('../../fixtures/fake-agent.mjs', import.meta.url));
const OUTPUT = { jobs: [{ company: 'Acme', title: 'Engineer', url: 'https://example.com/1' }] };
const TASK: AgentTask = { kind: 'discover_jobs', prompt: 'Find jobs', outputSchema: { type: 'object' } };

function fakeConfig(overrides: Partial<CliAdapterConfig> = {}): CliAdapterConfig {
  return { id: 'custom', argv: [process.execPath, FIXTURE], promptVia: 'file', resultFrom: 'stdout-json', ...overrides };
}

// Simulated Windows install: `fake` resolves to C:\tools\fake.cmd, an npm-style shim whose entry is the
// fixture. posix.resolve stands in for win32.join so the absolute fixture path stays openable off Windows.
function simulatedWin32Shim(): ResolveDeps {
  const shim = win32.join('C:\\tools', 'fake.cmd').toLowerCase();
  return {
    platform: 'win32',
    env: { PATH: 'C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    // Case-insensitive like a Windows file system: PATHEXT yields fake.CMD.
    exists: (p) => p.toLowerCase() === shim,
    readFile: (p) => {
      if (p.toLowerCase() !== shim) throw new Error(`unexpected read: ${p}`);
      return `@ECHO off\r\n"%_prog%"  "%dp0%\\${FIXTURE}" %*\r\n`;
    },
    execPath: process.execPath,
    join: posix.resolve,
  };
}

let cwd: string;

// Polls for the pid file the hang fixture writes on startup.
async function waitForPid(dir: string, timeoutMs = 2000): Promise<number> {
  const file = join(dir, 'fake-agent.pid');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const pid = Number(readFileSync(file, 'utf8'));
      if (pid > 0) return pid;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('fake agent did not write its pid file');
}

// Polls for the two-line pid file the hang-tree fixture writes: the agent, then its helper.
async function waitForPids(dir: string, timeoutMs = 2000): Promise<number[]> {
  const file = join(dir, 'fake-agent.pid');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const pids = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(Number);
      if (pids.length === 2 && pids.every((p) => p > 0)) return pids;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('fake agent did not write its pid file');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'jat-agent-'));
  process.env.FAKE_AGENT_OUTPUT = JSON.stringify(OUTPUT);
});

afterEach(() => {
  delete process.env.FAKE_AGENT_MODEL;
  delete process.env.FAKE_AGENT_MODELS;
  delete process.env.FAKE_AGENT_MODE;
  delete process.env.FAKE_AGENT_OUTPUT;
  delete process.env.FAKE_AGENT_AUTH;
  rmSync(cwd, { recursive: true, force: true });
});

describe('createCliAdapter run', () => {
  it('parses fenced stdout JSON and streams log lines', async () => {
    process.env.FAKE_AGENT_MODE = 'ok';
    const lines: string[] = [];
    const r = await createCliAdapter(fakeConfig()).run(TASK, { timeoutMs: 10_000, cwd, onLog: (l) => lines.push(l) });
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(OUTPUT);
    expect(r.exitCode).toBe(0);
    expect(lines.length).toBeGreaterThan(0);
    expect(r.rawStdout).toContain('```json');
    expect(readFileSync(join(cwd, 'prompt.md'), 'utf8')).toBe('Find jobs');
    expect(JSON.parse(readFileSync(join(cwd, 'schema.json'), 'utf8'))).toEqual({ type: 'object' });
  });

  it('parses JSON after prose', async () => {
    process.env.FAKE_AGENT_MODE = 'prose';
    const r = await createCliAdapter(fakeConfig()).run(TASK, { timeoutMs: 10_000, cwd });
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(OUTPUT);
  });

  it('reports a non-zero exit and prefixes stderr lines', async () => {
    process.env.FAKE_AGENT_MODE = 'fail';
    const lines: string[] = [];
    const r = await createCliAdapter(fakeConfig()).run(TASK, { timeoutMs: 10_000, cwd, onLog: (l) => lines.push(l) });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.error).toBe('Exited with code 2');
    expect(r.rawStderr).toContain('boom');
    expect(lines).toContain('[stderr] boom');
  });

  it('kills a hanging agent on timeout', async () => {
    process.env.FAKE_AGENT_MODE = 'hang';
    const started = Date.now();
    const running = createCliAdapter(fakeConfig()).run(TASK, { timeoutMs: 500, cwd });
    const [r, pid] = await Promise.all([running, waitForPid(cwd)]);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/i);
    expect(r.error).toBe('Timed out after 500 ms');
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('kills the agent when the signal aborts', async () => {
    process.env.FAKE_AGENT_MODE = 'hang';
    const ac = new AbortController();
    const running = createCliAdapter(fakeConfig()).run(TASK, { timeoutMs: 10_000, cwd, signal: ac.signal });
    // Abort only once the agent is known to be running.
    const pid = await waitForPid(cwd);
    expect(() => process.kill(pid, 0)).not.toThrow();
    ac.abort();
    const r = await running;
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Aborted');
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it.skipIf(process.platform === 'win32')('kills the whole process tree on timeout', async () => {
    process.env.FAKE_AGENT_MODE = 'hang-tree';
    const running = createCliAdapter(fakeConfig()).run(TASK, { timeoutMs: 500, cwd });
    const [r, pids] = await Promise.all([running, waitForPids(cwd)]);
    try {
      expect(r.error).toBe('Timed out after 500 ms');
      // The orphaned helper is reaped by init asynchronously, so allow it a moment to disappear.
      const deadline = Date.now() + 2000;
      while (pids.some(isAlive) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 20));
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      // Never leave a 60 s sleeper behind if the assertion above fails.
      for (const pid of pids.filter(isAlive)) process.kill(pid, 'SIGKILL');
    }
  });

  it('parses claude stream-json from stdin input', async () => {
    process.env.FAKE_AGENT_MODE = 'claude';
    const lines: string[] = [];
    const r = await createCliAdapter(
      fakeConfig({ argv: [process.execPath, FIXTURE, '--json-schema', '{schema}'], promptVia: 'stdin', resultFrom: 'claude-stream-json' }),
    ).run(TASK, { timeoutMs: 10_000, cwd, onLog: (l) => lines.push(l) });
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(OUTPUT);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]!).type).toBe('result');
  });

  it('reports the model named by the claude init event', async () => {
    process.env.FAKE_AGENT_MODE = 'claude';
    process.env.FAKE_AGENT_MODEL = 'model-a';
    const r = await createCliAdapter(
      fakeConfig({ argv: [process.execPath, FIXTURE], promptVia: 'stdin', resultFrom: 'claude-stream-json' }),
    ).run(TASK, { timeoutMs: 10_000, cwd });
    expect(r.ok).toBe(true);
    expect(r.reportedModel).toBe('model-a');
  });

  it('reports the claude model on a failed run too', async () => {
    process.env.FAKE_AGENT_MODE = 'claude-fail';
    process.env.FAKE_AGENT_MODEL = 'model-b';
    const r = await createCliAdapter(
      fakeConfig({ argv: [process.execPath, FIXTURE], promptVia: 'stdin', resultFrom: 'claude-stream-json' }),
    ).run(TASK, { timeoutMs: 10_000, cwd });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Exited with code 2');
    expect(r.reportedModel).toBe('model-b');
  });

  it('does not look for a reported model in other output formats', async () => {
    process.env.FAKE_AGENT_MODE = 'ok';
    process.env.FAKE_AGENT_OUTPUT = JSON.stringify({ type: 'system', subtype: 'init', model: 'model-c' });
    const r = await createCliAdapter(fakeConfig()).run(TASK, { timeoutMs: 10_000, cwd });
    expect(r.ok).toBe(true);
    expect(r.reportedModel).toBeUndefined();
  });

  it('exposes the requested selection on the adapter', () => {
    const selection = { model: 'model-a', effort: 'low' };
    expect(createCliAdapter(fakeConfig({ selection })).selection).toEqual(selection);
    expect(createCliAdapter(fakeConfig()).selection).toBeUndefined();
  });

  it('reads codex output from {output_file}', async () => {
    process.env.FAKE_AGENT_MODE = 'codex';
    const r = await createCliAdapter(
      fakeConfig({
        argv: [process.execPath, FIXTURE, '--output-schema', '{schema_file}', '-o', '{output_file}'],
        promptVia: 'argv',
        resultFrom: 'output-file',
      }),
    ).run(TASK, { timeoutMs: 10_000, cwd });
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(OUTPUT);
    expect(existsSync(join(cwd, 'output.json'))).toBe(true);
  });

  it('reports extraction failure', async () => {
    process.env.FAKE_AGENT_MODE = 'ok';
    process.env.FAKE_AGENT_OUTPUT = 'nothing useful';
    const r = await createCliAdapter(fakeConfig()).run(TASK, { timeoutMs: 10_000, cwd });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.error).toMatch(/json/i);
    expect(r.rawStdout).toContain('nothing useful');
  });

  it('expands vars and file placeholders into the spawned argv', async () => {
    process.env.FAKE_AGENT_MODE = 'echo-argv';
    const r = await createCliAdapter(
      fakeConfig({
        argv: [process.execPath, FIXTURE, '--mode', '{permission_mode}', '--prompt={prompt_file}', '{schema}', 'x{schema}'],
        vars: { permission_mode: 'xyz' },
      }),
    ).run(TASK, { timeoutMs: 10_000, cwd });
    expect(r.error).toBeUndefined();
    expect(r.output).toEqual({
      argv: ['--mode', 'xyz', `--prompt=${join(cwd, 'prompt.md')}`, JSON.stringify(TASK.outputSchema), 'x{schema}'],
    });
  });

  it('spawns node with the shim entry first when a win32 .cmd shim is resolved', async () => {
    process.env.FAKE_AGENT_MODE = 'echo-argv';
    const r = await createCliAdapter(
      fakeConfig({ argv: ['fake', '--mode', '{permission_mode}'], vars: { permission_mode: 'xyz' }, resolve: simulatedWin32Shim() }),
    ).run(TASK, { timeoutMs: 10_000, cwd });
    // The fixture echoes argv after the script, so this output only appears when node ran the fixture
    // with the original arguments after it: spawning `fake` would be ENOENT, a lost prefix would make node open `--mode`.
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ argv: ['--mode', 'xyz'] });
  });

  it('reports the original command when a simulated win32 command is not found', async () => {
    const r = await createCliAdapter(fakeConfig({ argv: ['missing-xyz'], resolve: simulatedWin32Shim() })).run(TASK, {
      timeoutMs: 10_000,
      cwd,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Command not found: missing-xyz');
  });

  it('resolves instead of rejecting when spawn throws synchronously', async () => {
    const r = await createCliAdapter(fakeConfig({ argv: [''] })).run(TASK, { timeoutMs: 10_000, cwd });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBeNull();
    expect(r.error).toMatch(/^Failed to start: /);
  });

  it('reports a missing command', async () => {
    const r = await createCliAdapter(fakeConfig({ argv: ['definitely-not-a-binary-xyz'] })).run(TASK, {
      timeoutMs: 10_000,
      cwd,
    });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBeNull();
    expect(r.error).toBe('Command not found: definitely-not-a-binary-xyz');
  });
});

describe('createCliAdapter check', () => {
  it('reports a missing binary as not installed', async () => {
    const h = await createCliAdapter(
      fakeConfig({ argv: ['definitely-not-a-binary-xyz'], versionArgv: ['definitely-not-a-binary-xyz', '--version'] }),
    ).check();
    expect(h.installed).toBe(false);
    expect(h.message).toBe('Not found on PATH');
  });

  it('resolves instead of rejecting when spawn throws synchronously', async () => {
    const h = await createCliAdapter(fakeConfig({ argv: [''] })).check();
    expect(h.installed).toBe(true);
    expect(h.version).toBeUndefined();
    expect(h.message).toMatch(/^Failed to start: /);
  });

  it('checks through a resolved win32 .cmd shim', async () => {
    process.env.FAKE_AGENT_MODE = 'echo-argv';
    const h = await createCliAdapter(
      fakeConfig({ argv: ['fake'], versionArgv: ['fake', '--version'], resolve: simulatedWin32Shim() }),
    ).check();
    expect(h.installed).toBe(true);
    expect(h.version).toBe(JSON.stringify({ argv: ['--version'] }));
  });

  it('reports the version of an installed binary', async () => {
    const h = await createCliAdapter(fakeConfig({ argv: [process.execPath, FIXTURE] })).check();
    expect(h.installed).toBe(true);
    expect(h.version).toBe(process.version);
  });
});

describe('createCliAdapter check sign-in probe', () => {
  const authConfig = (overrides: Partial<CliAdapterConfig> = {}) =>
    fakeConfig({
      versionArgv: [process.execPath, '--version'],
      authArgv: [process.execPath, FIXTURE, 'auth', 'status'],
      ...overrides,
    });

  it('reports authenticated when the probe exits 0', async () => {
    process.env.FAKE_AGENT_AUTH = 'ok';
    const h = await createCliAdapter(authConfig()).check();
    expect(h.installed).toBe(true);
    expect(h.authenticated).toBe(true);
    expect(h.authMessage).toBeUndefined();
  });

  it('reports not authenticated with the first output line on a non-zero exit', async () => {
    process.env.FAKE_AGENT_AUTH = 'fail';
    const h = await createCliAdapter(authConfig({ authArgv: [process.execPath, FIXTURE, 'login', 'status'] })).check();
    expect(h.installed).toBe(true);
    expect(h.authenticated).toBe(false);
    expect(h.authMessage).toBe('Not logged in');
  });

  it('leaves authenticated unknown when the probe times out', async () => {
    process.env.FAKE_AGENT_AUTH = 'hang';
    const h = await createCliAdapter(authConfig({ authTimeoutMs: 200 })).check();
    expect(h.installed).toBe(true);
    expect(h.authenticated).toBeUndefined();
    expect(h.authMessage).toMatch(/^Sign-in check failed: /);
  });

  it('leaves authenticated unknown when the probe cannot start', async () => {
    const h = await createCliAdapter(authConfig({ authArgv: ['definitely-not-a-binary-xyz', 'status'] })).check();
    expect(h.authenticated).toBeUndefined();
    expect(h.authMessage).toMatch(/^Sign-in check failed: /);
  });

  it('skips the probe when the version probe fails', async () => {
    process.env.FAKE_AGENT_AUTH = 'ok';
    const h = await createCliAdapter(
      authConfig({ versionArgv: ['definitely-not-a-binary-xyz', '--version'] }),
    ).check();
    expect(h.installed).toBe(false);
    expect(h.authenticated).toBeUndefined();
    expect(h.authMessage).toBeUndefined();
  });

  it('configures the claude and codex presets with their status commands and not custom', () => {
    const claude = buildAdapterConfig({ ...DEFAULT_SETTINGS, adapter_id: 'claude' }, 'discover_jobs');
    const codex = buildAdapterConfig({ ...DEFAULT_SETTINGS, adapter_id: 'codex' }, 'discover_jobs');
    const custom = buildAdapterConfig({ ...DEFAULT_SETTINGS, adapter_id: 'custom', custom_command: 'x' }, 'discover_jobs');
    expect(claude.authArgv).toEqual(['claude', 'auth', 'status']);
    expect(codex.authArgv).toEqual(['codex', 'login', 'status']);
    expect(custom.authArgv).toBeUndefined();
  });
});

describe('createCliAdapter listModels', () => {
  const CATALOG = {
    models: [
      {
        slug: 'model-a',
        display_name: 'Model A',
        visibility: 'list',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
      },
      { slug: 'model-hidden', display_name: 'Hidden', visibility: 'hide', supported_reasoning_levels: [{ effort: 'max' }] },
      { slug: 'model-b', visibility: 'list', supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'ultra' }] },
    ],
  };
  const modelsConfig = () => fakeConfig({ modelsArgv: [process.execPath, FIXTURE, 'debug', 'models'] });

  it('returns a static catalog without spawning anything', async () => {
    const catalog = { source: 'static' as const, models: [{ id: 'a', label: 'a', efforts: ['low'] }], efforts: ['low'] };
    const c = await createCliAdapter(fakeConfig({ argv: ['definitely-not-a-binary-xyz'], modelCatalog: catalog })).listModels();
    expect(c).toEqual(catalog);
  });

  it('parses the agent catalog, skips hidden models and unions the effort levels', async () => {
    process.env.FAKE_AGENT_MODELS = JSON.stringify(CATALOG);
    expect(await createCliAdapter(modelsConfig()).listModels()).toEqual({
      source: 'agent',
      models: [
        { id: 'model-a', label: 'Model A', efforts: ['low', 'high'] },
        { id: 'model-b', label: 'model-b', efforts: ['medium', 'ultra'] },
      ],
      efforts: ['low', 'high', 'medium', 'ultra'],
    });
  });

  it('drops catalog entries the settings API would reject', async () => {
    process.env.FAKE_AGENT_MODELS = JSON.stringify({
      models: [
        { slug: 'model a', supported_reasoning_levels: [{ effort: 'low' }] },
        { slug: '-model', supported_reasoning_levels: [{ effort: 'low' }] },
        { slug: 'model-c', supported_reasoning_levels: [{ effort: 'x-high' }, { effort: 'Minimal' }, { effort: 'high' }] },
      ],
    });
    expect(await createCliAdapter(modelsConfig()).listModels()).toEqual({
      source: 'agent',
      models: [{ id: 'model-c', label: 'model-c', efforts: ['high'] }],
      efforts: ['high'],
    });
  });

  it.each([
    ['the command fails', 'fail'],
    ['the output is not JSON', 'not json'],
    ['the output has an unexpected shape', JSON.stringify({ models: [{ display_name: 'no slug' }] })],
  ])('reports unavailable when %s', async (_name, models) => {
    process.env.FAKE_AGENT_MODELS = models;
    expect(await createCliAdapter(modelsConfig()).listModels()).toEqual({ source: 'unavailable', models: [], efforts: [] });
  });

  it('reports unavailable when the catalog command is missing', async () => {
    const c = await createCliAdapter(fakeConfig({ modelsArgv: ['definitely-not-a-binary-xyz', 'debug', 'models'] })).listModels();
    expect(c).toEqual({ source: 'unavailable', models: [], efforts: [] });
  });

  it('reports unavailable for an agent without any catalog', async () => {
    expect(await createCliAdapter(fakeConfig()).listModels()).toEqual({ source: 'unavailable', models: [], efforts: [] });
  });
});

describe('buildAdapterConfig', () => {
  it('passes the sync_mail allowed tools to claude', () => {
    const settings = { ...DEFAULT_SETTINGS, adapter_id: 'claude' as const };
    const c = buildAdapterConfig(settings, 'sync_mail');
    const i = c.argv.indexOf('--allowedTools');
    expect(i).toBeGreaterThan(-1);
    expect(c.argv[i + 1]).toBe('{allowed_tools}');
    expect(c.vars?.allowed_tools).toBe(settings.allowed_tools_sync);
    expect(c.vars?.permission_mode).toBe(settings.permission_mode_sync);
    expect(c.promptVia).toBe('stdin');
    expect(c.resultFrom).toBe('claude-stream-json');
  });

  it.each(['discover_jobs', 'sync_mail'] as const)('claude preset skips project settings and denies subagents for %s', (kind) => {
    const c = buildAdapterConfig({ ...DEFAULT_SETTINGS, adapter_id: 'claude' }, kind);
    expect(c.argv.slice(c.argv.indexOf('--setting-sources'), c.argv.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', 'user']);
    expect(c.argv.slice(c.argv.indexOf('--disallowedTools'), c.argv.indexOf('--disallowedTools') + 2)).toEqual(['--disallowedTools', 'Agent,Task']);
    expect(c.argv.filter((a) => a === '--allowedTools')).toHaveLength(1);
  });

  it('uses the discover sandbox for codex', () => {
    const settings = { ...DEFAULT_SETTINGS, adapter_id: 'codex' as const, sandbox_discover: 'workspace-write' };
    const c = buildAdapterConfig(settings, 'discover_jobs');
    expect(c.argv).toEqual([
      'codex', 'exec', '--json', '--output-schema', '{schema_file}', '--skip-git-repo-check',
      '--sandbox', '{sandbox}', '-o', '{output_file}',
    ]);
    expect(c.vars?.sandbox).toBe('workspace-write');
    expect(c.promptVia).toBe('argv');
    expect(c.resultFrom).toBe('output-file');
  });

  it('adds no model or effort flag when both are agent default', () => {
    const claude = buildAdapterConfig({ ...DEFAULT_SETTINGS, adapter_id: 'claude' }, 'discover_jobs');
    expect(claude.argv).not.toContain('--model');
    expect(claude.argv).not.toContain('--effort');
    expect(claude.selection).toEqual({ model: '', effort: '' });
  });

  it.each([
    ['discover_jobs', ['--model', 'opus', '--effort', 'high']],
    ['sync_mail', ['--model', 'sonnet', '--effort', 'low']],
  ] as const)('passes the claude model and effort for %s', (kind, flags) => {
    const settings = {
      ...DEFAULT_SETTINGS,
      adapter_id: 'claude' as const,
      claude_model_discover: 'opus',
      claude_effort_discover: 'high',
      claude_model_sync: 'sonnet',
      claude_effort_sync: 'low',
      codex_model_discover: 'model-x',
    };
    const c = buildAdapterConfig(settings, kind);
    expect(c.argv.slice(-4)).toEqual(flags);
    expect(c.selection).toEqual({ model: flags[1], effort: flags[3] });
  });

  it('passes only the claude effort when the model is agent default', () => {
    const settings = { ...DEFAULT_SETTINGS, adapter_id: 'claude' as const, claude_effort_sync: 'max' };
    const c = buildAdapterConfig(settings, 'sync_mail');
    expect(c.argv).not.toContain('--model');
    expect(c.argv.slice(-2)).toEqual(['--effort', 'max']);
  });

  it('passes the codex model and reasoning effort as a quoted TOML string', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      adapter_id: 'codex' as const,
      codex_model_sync: 'model-a',
      codex_effort_sync: 'xhigh',
      claude_model_sync: 'opus',
    };
    const c = buildAdapterConfig(settings, 'sync_mail');
    expect(c.argv.slice(-4)).toEqual(['-m', 'model-a', '-c', 'model_reasoning_effort="xhigh"']);
    expect(c.selection).toEqual({ model: 'model-a', effort: 'xhigh' });
    expect(c.modelsArgv).toEqual(['codex', 'debug', 'models']);
  });

  it('refuses a stored model or effort that could be read as a flag', () => {
    const claude = { ...DEFAULT_SETTINGS, adapter_id: 'claude' as const, claude_model_discover: '--bare' };
    expect(() => buildAdapterConfig(claude, 'discover_jobs')).toThrow('Invalid model setting: --bare');
    const codex = { ...DEFAULT_SETTINGS, adapter_id: 'codex' as const, codex_effort_sync: 'high" -x' };
    expect(() => buildAdapterConfig(codex, 'sync_mail')).toThrow('Invalid effort setting');
  });

  it('gives custom commands no selection and no catalog', () => {
    const c = buildAdapterConfig({ ...DEFAULT_SETTINGS, adapter_id: 'custom', custom_command: 'x' }, 'sync_mail');
    expect(c.selection).toBeUndefined();
    expect(c.modelsArgv).toBeUndefined();
    expect(c.modelCatalog).toBeUndefined();
  });

  it('splits a quoted custom command', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      adapter_id: 'custom' as const,
      custom_command: `my-agent --name 'two words' --file "{prompt_file}" "say \\"hi\\"" ''`,
    };
    const c = buildAdapterConfig(settings, 'discover_jobs');
    expect(c.argv).toEqual(['my-agent', '--name', 'two words', '--file', '{prompt_file}', 'say "hi"', '']);
    expect(c.promptVia).toBe('file');
    expect(c.resultFrom).toBe('stdout-json');
  });

  it('rejects an empty custom command', () => {
    const settings = { ...DEFAULT_SETTINGS, adapter_id: 'custom' as const, custom_command: '   ' };
    expect(() => buildAdapterConfig(settings, 'sync_mail')).toThrow('Custom command is empty');
  });
});

describe('createAdapter', () => {
  it('builds an adapter from settings', () => {
    expect(createAdapter(DEFAULT_SETTINGS, 'discover_jobs').id).toBe('claude');
  });
});
