import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCliAdapter } from '../../../src/server/agents/cli-adapter.js';
import { createAdapter } from '../../../src/server/agents/index.js';
import { buildAdapterConfig } from '../../../src/server/agents/presets.js';
import type { AgentTask, CliAdapterConfig } from '../../../src/server/agents/types.js';
import { DEFAULT_SETTINGS } from '../../../src/server/db/settings-repo.js';

const FIXTURE = fileURLToPath(new URL('../../fixtures/fake-agent.mjs', import.meta.url));
const OUTPUT = { jobs: [{ company: 'Acme', title: 'Engineer', url: 'https://example.com/1' }] };
const TASK: AgentTask = { kind: 'discover_jobs', prompt: 'Find jobs', outputSchema: { type: 'object' } };

function fakeConfig(overrides: Partial<CliAdapterConfig> = {}): CliAdapterConfig {
  return { id: 'custom', argv: [process.execPath, FIXTURE], promptVia: 'file', resultFrom: 'stdout-json', ...overrides };
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

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'jat-agent-'));
  process.env.FAKE_AGENT_OUTPUT = JSON.stringify(OUTPUT);
});

afterEach(() => {
  delete process.env.FAKE_AGENT_MODE;
  delete process.env.FAKE_AGENT_OUTPUT;
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

  it('reports the version of an installed binary', async () => {
    const h = await createCliAdapter(fakeConfig({ argv: [process.execPath, FIXTURE] })).check();
    expect(h.installed).toBe(true);
    expect(h.version).toBe(process.version);
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
