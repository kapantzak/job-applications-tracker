import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

  function launch(args: string[]): { child: ChildProcess; exited: Promise<Result>; out: () => string } {
    const child = spawn(process.execPath, ['bin/jobtrack.js', ...args], {
      cwd: repoRoot,
      env: { ...process.env, CI: '' },
    });
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
});
