import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('package metadata', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

  it('declares the MIT license, repository and ships LICENSE', () => {
    expect(pkg.license).toBe('MIT');
    expect(pkg.repository.url).toBe('git+https://github.com/kapantzak/job-applications-tracker.git');
    expect(pkg.files).toContain('LICENSE');
  });

  it('has a LICENSE file at the package root that matches', () => {
    const path = join(repoRoot, 'LICENSE');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8').startsWith('MIT License')).toBe(true);
  });

  // Mock runs, screenshots and the demo video must never show an update notice (SOW-0053).
  it('turns the update check off for the mock sandbox and the demo recording', () => {
    expect(pkg.scripts['sandbox:mock']).toContain('node --env-file=scripts/sandbox-mock/no-update-check.env bin/jobtrack.js');
    const envFile = readFileSync(join(repoRoot, 'scripts/sandbox-mock/no-update-check.env'), 'utf8');
    expect(envFile).toMatch(/^NO_UPDATE_NOTIFIER=1$/m);
    expect(readFileSync(join(repoRoot, 'scripts/demo-video/record.mjs'), 'utf8')).toContain(
      "env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }",
    );
  });
});
