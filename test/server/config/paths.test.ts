import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configFilePath,
  ensureDataDir,
  expandHome,
  locateDataDir,
  prepareDataDir,
  readConfig,
  resolveDataDir,
  writeConfig,
} from '../../../src/server/config/paths.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'jobtrack-paths-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function placeConfig(content: string): string {
  const file = configFilePath(tmp);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

describe('resolveDataDir', () => {
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

describe('locateDataDir', () => {
  it('reports the default source when nothing is set and no config file exists', () => {
    expect(locateDataDir({ env: {}, home: tmp })).toEqual({
      dir: join(tmp, '.job-applications-tracker'),
      source: 'default',
      configFile: join(tmp, '.config', 'job-applications-tracker', 'config.json'),
    });
  });

  it('uses the config file over the default', () => {
    const chosen = join(tmp, 'chosen');
    placeConfig(JSON.stringify({ dataDir: chosen }));
    expect(locateDataDir({ env: {}, home: tmp })).toMatchObject({ dir: chosen, source: 'config' });
  });

  it('uses JOBTRACK_DATA_DIR over the config file', () => {
    placeConfig(JSON.stringify({ dataDir: join(tmp, 'chosen') }));
    const envDir = join(tmp, 'from-env');
    expect(locateDataDir({ env: { JOBTRACK_DATA_DIR: envDir }, home: tmp })).toMatchObject({
      dir: envDir,
      source: 'env',
    });
  });

  it('uses the flag over everything and does not read a broken config file', () => {
    placeConfig('{not json');
    const flagDir = join(tmp, 'from-flag');
    expect(
      locateDataDir({ flag: flagDir, env: { JOBTRACK_DATA_DIR: join(tmp, 'e') }, home: tmp }),
    ).toMatchObject({ dir: flagDir, source: 'flag' });
  });

  it('uses the default when the config file has no dataDir', () => {
    placeConfig('{}');
    expect(locateDataDir({ env: {}, home: tmp })).toMatchObject({
      dir: join(tmp, '.job-applications-tracker'),
      source: 'default',
    });
  });

  it('treats an empty flag or env as unset', () => {
    expect(locateDataDir({ flag: '', env: { JOBTRACK_DATA_DIR: '' }, home: tmp }).source).toBe('default');
  });

  it('expands a leading ~ in the flag, the env var and the config file', () => {
    expect(locateDataDir({ flag: '~/f', env: {}, home: tmp }).dir).toBe(join(tmp, 'f'));
    expect(locateDataDir({ env: { JOBTRACK_DATA_DIR: '~/e' }, home: tmp }).dir).toBe(join(tmp, 'e'));
    placeConfig(JSON.stringify({ dataDir: '~/c' }));
    expect(locateDataDir({ env: {}, home: tmp }).dir).toBe(join(tmp, 'c'));
  });

  it('resolves a relative flag against the working directory', () => {
    expect(locateDataDir({ flag: 'rel/dir', env: {}, home: tmp }).dir).toBe(resolve('rel/dir'));
  });

  it('refuses a relative dataDir in the config file', () => {
    const file = placeConfig(JSON.stringify({ dataDir: 'relative/dir' }));
    expect(() => locateDataDir({ env: {}, home: tmp })).toThrow(
      `${file}: "dataDir" must be an absolute path. Fix or delete the file.`,
    );
  });
});

describe('expandHome', () => {
  it('expands ~ and ~/ only', () => {
    expect(expandHome('~', '/h')).toBe('/h');
    expect(expandHome('~/a/b', '/h')).toBe(join('/h', 'a/b'));
    expect(expandHome('~user/a', '/h')).toBe('~user/a');
    expect(expandHome('/x/~/y', '/h')).toBe('/x/~/y');
    expect(expandHome('a~', '/h')).toBe('a~');
  });
});

describe('readConfig and writeConfig', () => {
  it('returns null when the config file does not exist', () => {
    expect(readConfig(tmp)).toBeNull();
  });

  it('writes the file, creating its folder, and reads it back', () => {
    writeConfig({ dataDir: '/data/a' }, tmp);
    const file = configFilePath(tmp);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ dataDir: '/data/a' });
    expect(readConfig(tmp)).toEqual({ dataDir: '/data/a' });
  });

  it('keeps keys it does not know when rewriting', () => {
    placeConfig(JSON.stringify({ dataDir: '/data/a', future: 1 }));
    writeConfig({ ...readConfig(tmp), dataDir: '/data/b' }, tmp);
    expect(readConfig(tmp)).toEqual({ dataDir: '/data/b', future: 1 });
  });

  it('removes its temporary file when the write fails', () => {
    // A non-empty folder where the file should be makes the rename fail.
    mkdirSync(join(configFilePath(tmp), 'blocker'), { recursive: true });
    expect(() => writeConfig({ dataDir: '/data/a' }, tmp)).toThrow();
    expect(readdirSync(dirname(configFilePath(tmp)))).toEqual(['config.json']);
  });

  it('refuses a file that is not valid JSON', () => {
    const file = placeConfig('{not json');
    expect(() => readConfig(tmp)).toThrow(`${file} is not valid JSON. Fix or delete the file.`);
  });

  it('refuses a file that is not a JSON object', () => {
    const file = placeConfig('[]');
    expect(() => readConfig(tmp)).toThrow(`${file} must hold a JSON object. Fix or delete the file.`);
  });

  it('refuses a dataDir that is not a non-empty string', () => {
    const file = placeConfig(JSON.stringify({ dataDir: 3 }));
    expect(() => readConfig(tmp)).toThrow(`${file}: "dataDir" must be a non-empty string. Fix or delete the file.`);
    placeConfig(JSON.stringify({ dataDir: '' }));
    expect(() => readConfig(tmp)).toThrow('"dataDir" must be a non-empty string');
  });
});

describe('prepareDataDir', () => {
  it('creates a missing folder recursively', () => {
    const dir = join(tmp, 'a', 'b');
    prepareDataDir(dir);
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  it('accepts an existing writable folder', () => {
    expect(() => prepareDataDir(tmp)).not.toThrow();
  });

  it('refuses a path that is a file', () => {
    const file = join(tmp, 'file');
    writeFileSync(file, 'x');
    expect(() => prepareDataDir(file)).toThrow(`${file} is a file, not a folder.`);
  });

  it('refuses a path below a file', () => {
    const file = join(tmp, 'file');
    writeFileSync(file, 'x');
    expect(() => prepareDataDir(join(file, 'sub'))).toThrow(`Cannot create ${join(file, 'sub')}`);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('refuses a folder that is not writable', () => {
    const dir = join(tmp, 'locked');
    mkdirSync(dir);
    chmodSync(dir, 0o500);
    try {
      expect(() => prepareDataDir(dir)).toThrow(`${dir} is not writable.`);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});

describe('ensureDataDir', () => {
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
