import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The bin imports dist/, so build once up front to keep the test self-contained.
beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
}, 60_000);

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

describe('bin/jobtrack.js', () => {
  const children: ChildProcess[] = [];
  const dirs: string[] = [];

  afterEach(() => {
    for (const c of children.splice(0)) {
      if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
    }
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function launch(
    args: string[],
    env: NodeJS.ProcessEnv = { ...process.env, CI: '' },
  ): { child: ChildProcess; exited: Promise<Result>; out: () => string } {
    const child = spawn(process.execPath, ['bin/jobtrack.js', ...args], { cwd: repoRoot, env });
    children.push(child);
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr!.on('data', (d: Buffer) => (stderr += d.toString()));
    const exited = new Promise<Result>((res) =>
      child.on('close', (code) => res({ code, stdout, stderr })),
    );
    return { child, exited, out: () => stdout };
  }

  async function waitFor(cond: () => boolean, ms = 15_000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error('timed out waiting for output');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('starts, serves health, and exits 0 on SIGINT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobtrack-bin-'));
    dirs.push(dir);
    const { child, exited, out } = launch(['--no-open', '--port', '0', '--data-dir', dir]);
    await waitFor(() => /running at http:\/\/\S+/.test(out()) && out().includes('Data directory:'));
    const url = /running at (http:\/\/\S+)/.exec(out())![1]!;
    expect(out()).toContain(`Data directory: ${dir}`);
    const res = await fetch(`${url}/api/health`);
    expect(res.status).toBe(200);
    child.kill('SIGINT');
    const result = await Promise.race([
      exited,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no exit within 5s')), 5000)),
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Shutting down...');
  }, 30_000);

  it('prints usage on --help', async () => {
    const r = await launch(['--help']).exited;
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('--data-dir');
  });

  it('prints a semver on --version', async () => {
    const r = await launch(['--version']).exited;
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exits 2 on an unknown flag', async () => {
    const r = await launch(['--bogus']).exited;
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--data-dir');
  });

  // A temporary HOME keeps these tests away from the real ~/.config and ~/.job-applications-tracker.
  function homeEnv(): { home: string; env: NodeJS.ProcessEnv } {
    const home = mkdtempSync(join(tmpdir(), 'jobtrack-bin-home-'));
    dirs.push(home);
    const env: NodeJS.ProcessEnv = { ...process.env, CI: '', HOME: home, USERPROFILE: home };
    delete env.JOBTRACK_DATA_DIR;
    return { home, env };
  }

  async function startAndStop(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
    const { child, exited, out } = launch(['--no-open', '--port', '0', ...args], env);
    await waitFor(() => /Data directory: \S+/.test(out()));
    const dir = /Data directory: (.+)\n/.exec(out())![1]!;
    child.kill('SIGINT');
    expect((await exited).code).toBe(0);
    return dir;
  }

  it('uses the folder saved by "config set data-dir" on the next start', async () => {
    const { home, env } = homeEnv();
    const chosen = join(home, 'chosen');
    const set = await launch(['config', 'set', 'data-dir', chosen], env).exited;
    expect(set.code).toBe(0);
    expect(set.stdout).toBe(`Data directory set to ${chosen}. It is used from the next start.\n`);
    expect(JSON.parse(readFileSync(join(home, '.config', 'job-applications-tracker', 'config.json'), 'utf8'))).toEqual({
      dataDir: chosen,
    });
    expect(await startAndStop([], env)).toBe(chosen);
    expect(existsSync(join(chosen, 'data.db'))).toBe(true);
  }, 30_000);

  it('uses the default without asking or writing a config file when stdin is not a terminal', async () => {
    const { home, env } = homeEnv();
    expect(await startAndStop([], env)).toBe(join(home, '.job-applications-tracker'));
    expect(existsSync(join(home, '.config'))).toBe(false);
  }, 30_000);

  it('exits 1 when the folder from the config file is missing', async () => {
    const { home, env } = homeEnv();
    const gone = join(home, 'gone');
    mkdirSync(join(home, '.config', 'job-applications-tracker'), { recursive: true });
    writeFileSync(join(home, '.config', 'job-applications-tracker', 'config.json'), JSON.stringify({ dataDir: gone }));
    const r = await launch(['--no-open', '--port', '0'], env).exited;
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`Error: The data directory ${gone}`);
    expect(existsSync(gone)).toBe(false);
  });

  it('prints the folder in use on "config get data-dir"', async () => {
    const { home, env } = homeEnv();
    const r = await launch(['config', 'get', 'data-dir'], env).exited;
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`Data directory: ${join(home, '.job-applications-tracker')}\nSource: default\n`);
  });

  it('prints config usage on "config --help"', async () => {
    const r = await launch(['config', '--help']).exited;
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('set data-dir <path>');
  });

  it('exits 2 when "config" is given app options', async () => {
    const { home, env } = homeEnv();
    const r = await launch(['config', '--port', '1', 'set', 'data-dir', join(home, 'x')], env).exited;
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('"config" takes no options');
    expect(existsSync(join(home, '.config'))).toBe(false);
  });

  it('exits 2 on an unknown command', async () => {
    const r = await launch(['bogus']).exited;
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Unknown command "bogus"');
  });
});
