import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_USAGE, runConfigCommand } from '../../../src/server/config/cli.js';
import { configFilePath, writeConfig } from '../../../src/server/config/paths.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'jobtrack-config-cli-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  let stdout = '';
  let stderr = '';
  const code = runConfigCommand({
    args,
    env,
    home,
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  });
  return { code, stdout, stderr };
}

const defaultDir = () => join(home, '.job-applications-tracker');
const savedConfig = () => JSON.parse(readFileSync(configFilePath(home), 'utf8')) as unknown;
function placeDb(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'data.db'), '');
}

describe('config set data-dir', () => {
  it('creates the folder, saves its absolute path and says when it applies', () => {
    const r = run(['set', 'data-dir', '~/jobs']);
    const dir = join(home, 'jobs');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`Data directory set to ${dir}. It is used from the next start.\n`);
    expect(r.stderr).toBe('');
    expect(statSync(dir).isDirectory()).toBe(true);
    expect(savedConfig()).toEqual({ dataDir: dir });
  });

  it('keeps other keys in the config file', () => {
    mkdirSync(dirname(configFilePath(home)), { recursive: true });
    writeFileSync(configFilePath(home), JSON.stringify({ dataDir: join(home, 'a'), future: true }));
    expect(run(['set', 'data-dir', join(home, 'b')]).code).toBe(0);
    expect(savedConfig()).toEqual({ dataDir: join(home, 'b'), future: true });
  });

  it('warns that data in the previous folder is not moved', () => {
    placeDb(defaultDir());
    const dir = join(home, 'new');
    const r = run(['set', 'data-dir', dir]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe(
      `Warning: your data in ${defaultDir()} was not moved. ` +
        `To keep it, stop the app and move everything inside ${defaultDir()} into ${dir}.\n`,
    );
  });

  it('does not warn when the new folder already holds a database', () => {
    placeDb(defaultDir());
    const dir = join(home, 'other');
    placeDb(dir);
    expect(run(['set', 'data-dir', dir]).stderr).toBe('');
  });

  it('notes that JOBTRACK_DATA_DIR takes precedence when it is set', () => {
    const r = run(['set', 'data-dir', join(home, 'x')], { JOBTRACK_DATA_DIR: join(home, 'env') });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('JOBTRACK_DATA_DIR is set and takes precedence over the config file.');
  });

  it('refuses a file and leaves the config file alone', () => {
    const file = join(home, 'a-file');
    writeFileSync(file, 'x');
    const r = run(['set', 'data-dir', file]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(`Error: ${file} is a file, not a folder.\n`);
    expect(existsSync(configFilePath(home))).toBe(false);
  });

  it('refuses to overwrite a broken config file', () => {
    mkdirSync(dirname(configFilePath(home)), { recursive: true });
    writeFileSync(configFilePath(home), '{broken');
    const r = run(['set', 'data-dir', join(home, 'x')]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(`Error: ${configFilePath(home)} is not valid JSON. Fix or delete the file.\n`);
    expect(readFileSync(configFilePath(home), 'utf8')).toBe('{broken');
  });
});

describe('config get data-dir', () => {
  it('shows the default when nothing is set', () => {
    const r = run(['get', 'data-dir']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`Data directory: ${defaultDir()}\nSource: default\n`);
  });

  it('shows the folder from the config file', () => {
    const dir = join(home, 'chosen');
    mkdirSync(dir);
    writeConfig({ dataDir: dir }, home);
    const r = run(['get', 'data-dir']);
    expect(r.stdout).toBe(`Data directory: ${dir}\nSource: config file ${configFilePath(home)}\n`);
    expect(r.stderr).toBe('');
  });

  it('warns when the folder from the config file is missing', () => {
    const dir = join(home, 'gone');
    writeConfig({ dataDir: dir }, home);
    const r = run(['get', 'data-dir']);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe(`Warning: ${dir} does not exist, so the app will not start.\n`);
  });

  it('shows JOBTRACK_DATA_DIR when it is set', () => {
    const dir = join(home, 'env');
    expect(run(['get', 'data-dir'], { JOBTRACK_DATA_DIR: dir }).stdout).toBe(
      `Data directory: ${dir}\nSource: JOBTRACK_DATA_DIR\n`,
    );
  });
});

describe('config unset data-dir', () => {
  it('removes dataDir but keeps the file, so the first-run question is not asked again', () => {
    writeConfig({ dataDir: join(home, 'chosen'), future: 1 }, home);
    const r = run(['unset', 'data-dir']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`Data directory reset to the default ${defaultDir()}. It is used from the next start.\n`);
    expect(savedConfig()).toEqual({ future: 1 });
  });

  it('writes an empty config file when there was none', () => {
    expect(run(['unset', 'data-dir']).code).toBe(0);
    expect(savedConfig()).toEqual({});
  });

  it('warns that data in the configured folder is not moved', () => {
    const dir = join(home, 'chosen');
    placeDb(dir);
    writeConfig({ dataDir: dir }, home);
    expect(run(['unset', 'data-dir']).stderr).toBe(
      `Warning: your data in ${dir} was not moved. ` +
        `To keep it, stop the app and move everything inside ${dir} into ${defaultDir()}.\n`,
    );
  });
});

describe('config usage errors', () => {
  it.each([[[]], [['get']], [['set', 'data-dir']], [['set', 'data-dir', '']], [['set', 'data-dir', '  ']], [['set', 'port', '1']], [['unset', 'data-dir', 'x']], [['bogus']]])(
    'exits 2 with usage for %j',
    (args) => {
      const r = run(args);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(CONFIG_USAGE);
      expect(existsSync(configFilePath(home))).toBe(false);
    },
  );
});
