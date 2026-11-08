import { accessSync, constants, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const DEFAULT_DIR_NAME = '.job-applications-tracker';
// Outside the data directory on purpose: the file says where that directory is (SOW-0025, decision 4).
const CONFIG_DIR_PARTS = ['.config', 'job-applications-tracker'];
const CONFIG_FILE_NAME = 'config.json';

export type DataDirSource = 'flag' | 'env' | 'config' | 'default';

export interface ResolveDataDirOptions {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export interface LocatedDataDir {
  dir: string;
  source: DataDirSource;
  configFile: string;
}

export interface AppConfig {
  dataDir?: string;
  // Keys written by a newer version are kept when this version rewrites the file.
  [key: string]: unknown;
}

export class ConfigFileError extends Error {}
export class DataDirError extends Error {}

// Only "~" and "~/..." are expanded; "~user" stays as written.
export function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/') || (process.platform === 'win32' && path.startsWith('~\\'))) {
    return join(home, path.slice(2));
  }
  return path;
}

export function defaultDataDir(home: string = homedir()): string {
  return join(home, DEFAULT_DIR_NAME);
}

export function configFilePath(home: string = homedir()): string {
  return join(home, ...CONFIG_DIR_PARTS, CONFIG_FILE_NAME);
}

// null when the file does not exist. A broken file is an error, never silently replaced (SOW-0025).
export function readConfig(home: string = homedir()): AppConfig | null {
  const file = configFilePath(home);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ConfigFileError(`Cannot read ${file}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigFileError(`${file} is not valid JSON. Fix or delete the file.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigFileError(`${file} must hold a JSON object. Fix or delete the file.`);
  }
  const config = parsed as AppConfig;
  if ('dataDir' in config && (typeof config.dataDir !== 'string' || config.dataDir === '')) {
    throw new ConfigFileError(`${file}: "dataDir" must be a non-empty string. Fix or delete the file.`);
  }
  return config;
}

// Write-then-rename, so an interrupted write never leaves a half-written file behind.
export function writeConfig(config: AppConfig, home: string = homedir()): void {
  const file = configFilePath(home);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Precedence: --data-dir flag, then JOBTRACK_DATA_DIR, then the config file, then ~/.job-applications-tracker.
// Empty values count as unset so a blank env var does not point the app at the cwd. The config file is
// read only when it decides the answer, so a broken file never blocks a run that names its folder.
export function locateDataDir(opts: ResolveDataDirOptions): LocatedDataDir {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const configFile = configFilePath(home);
  if (opts.flag) return { dir: resolve(expandHome(opts.flag, home)), source: 'flag', configFile };
  if (env.JOBTRACK_DATA_DIR) {
    return { dir: resolve(expandHome(env.JOBTRACK_DATA_DIR, home)), source: 'env', configFile };
  }
  const configured = readConfig(home)?.dataDir;
  if (configured) {
    const dir = expandHome(configured, home);
    if (!isAbsolute(dir)) {
      throw new ConfigFileError(`${configFile}: "dataDir" must be an absolute path. Fix or delete the file.`);
    }
    return { dir: resolve(dir), source: 'config', configFile };
  }
  return { dir: defaultDataDir(home), source: 'default', configFile };
}

export function resolveDataDir(opts: ResolveDataDirOptions): string {
  return locateDataDir(opts).dir;
}

// Checks a folder the user is choosing: creates it when missing, refuses a file or a folder the app
// could not write to.
export function prepareDataDir(dir: string): void {
  let isDir: boolean | null = null;
  try {
    isDir = statSync(dir).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new DataDirError(`Cannot create ${dir}: ${(err as Error).message}`);
    }
  }
  if (isDir === false) throw new DataDirError(`${dir} is a file, not a folder.`);
  if (isDir === null) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new DataDirError(`Cannot create ${dir}: ${(err as Error).message}`);
    }
  }
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new DataDirError(`${dir} is not writable.`);
  }
}

export function ensureDataDir(dir: string): { dbFile: string; runsDir: string } {
  const runsDir = join(dir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  return { dbFile: join(dir, 'data.db'), runsDir };
}
