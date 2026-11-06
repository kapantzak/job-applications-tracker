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
});
