import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDataDir, resolveDataDir } from '../../../src/server/config/paths.js';

describe('resolveDataDir', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jobtrack-paths-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('defaults to <home>/.job-applications-tracker when no flag or env is set', () => {
    expect(resolveDataDir({ env: {}, home: tmp })).toBe(join(tmp, '.job-applications-tracker'));
  });

  it('uses JOBTRACK_DATA_DIR over the home default', () => {
    const envDir = join(tmp, 'from-env');
    expect(resolveDataDir({ env: { JOBTRACK_DATA_DIR: envDir }, home: tmp })).toBe(envDir);
  });

  it('uses the flag over JOBTRACK_DATA_DIR', () => {
    const flagDir = join(tmp, 'from-flag');
    const envDir = join(tmp, 'from-env');
    expect(
      resolveDataDir({ flag: flagDir, env: { JOBTRACK_DATA_DIR: envDir }, home: tmp }),
    ).toBe(flagDir);
  });
});

describe('ensureDataDir', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jobtrack-paths-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates the directory and its runs/ subdirectory recursively', () => {
    const dir = join(tmp, 'nested', 'data');
    const result = ensureDataDir(dir);

    expect(statSync(dir).isDirectory()).toBe(true);
    expect(result.runsDir).toBe(join(dir, 'runs'));
    expect(existsSync(result.runsDir)).toBe(true);
    expect(statSync(result.runsDir).isDirectory()).toBe(true);
  });

  it('returns a dbFile ending in data.db inside the directory', () => {
    const dir = join(tmp, 'data');
    const result = ensureDataDir(dir);

    expect(result.dbFile).toBe(join(dir, 'data.db'));
    expect(result.dbFile.endsWith('data.db')).toBe(true);
  });
});
