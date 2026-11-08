import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ConfigFileError,
  DataDirError,
  defaultDataDir,
  expandHome,
  locateDataDir,
  prepareDataDir,
  readConfig,
  writeConfig,
  type AppConfig,
} from './paths.js';

export const CONFIG_USAGE = `Usage: jobtrack config <command>

Commands:
  get data-dir           Show the data directory in use and where it comes from
  set data-dir <path>    Use <path> for data from the next start (created if missing)
  unset data-dir         Go back to the default data directory
`;

export interface ConfigCommandOptions {
  // Words after "config", for example ["set", "data-dir", "~/jobs"].
  args: string[];
  env?: NodeJS.ProcessEnv;
  home?: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

// Returns the process exit code: 0 done, 1 refused, 2 usage error.
export function runConfigCommand(opts: ConfigCommandOptions): number {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const [command, key, ...rest] = opts.args;
  const arity = command === 'set' ? 1 : 0;
  // An empty path would resolve to the cwd (for example an unset "$DIR"); empty counts as missing.
  const emptyPath = command === 'set' && rest.length === 1 && rest[0]!.trim() === '';
  if (!['get', 'set', 'unset'].includes(command ?? '') || key !== 'data-dir' || rest.length !== arity || emptyPath) {
    opts.stderr(CONFIG_USAGE);
    return 2;
  }
  try {
    if (command === 'get') getDataDir(env, home, opts);
    else if (command === 'set') setDataDir(rest[0]!, readConfig(home), env, home, opts);
    else unsetDataDir(readConfig(home), env, home, opts);
    return 0;
  } catch (err) {
    if (err instanceof ConfigFileError || err instanceof DataDirError) {
      opts.stderr(`Error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

function getDataDir(env: NodeJS.ProcessEnv, home: string, out: ConfigCommandOptions): void {
  const located = locateDataDir({ env, home });
  const source =
    located.source === 'env'
      ? 'JOBTRACK_DATA_DIR'
      : located.source === 'config'
        ? `config file ${located.configFile}`
        : 'default';
  out.stdout(`Data directory: ${located.dir}\nSource: ${source}\n`);
  if (located.source === 'config' && !existsSync(located.dir)) {
    out.stderr(`Warning: ${located.dir} does not exist, so the app will not start.\n`);
  }
}

function setDataDir(
  path: string,
  existing: AppConfig | null,
  env: NodeJS.ProcessEnv,
  home: string,
  out: ConfigCommandOptions,
): void {
  const dir = resolve(expandHome(path, home));
  prepareDataDir(dir);
  const previous = configuredDir(existing, home);
  writeConfig({ ...existing, dataDir: dir }, home);
  out.stdout(`Data directory set to ${dir}. It is used from the next start.\n`);
  warnAfterChange(previous, dir, env, out);
}

function unsetDataDir(
  existing: AppConfig | null,
  env: NodeJS.ProcessEnv,
  home: string,
  out: ConfigCommandOptions,
): void {
  const previous = configuredDir(existing, home);
  const next: AppConfig = { ...existing };
  delete next.dataDir;
  // The file stays, without dataDir, so the first-run question is not asked again (SOW-0025).
  writeConfig(next, home);
  const dir = defaultDataDir(home);
  out.stdout(`Data directory reset to the default ${dir}. It is used from the next start.\n`);
  warnAfterChange(previous, dir, env, out);
}

// The folder used before this change when no flag or env var overrides it.
function configuredDir(config: AppConfig | null, home: string): string {
  return config?.dataDir ? resolve(expandHome(config.dataDir, home)) : defaultDataDir(home);
}

// Data is never moved (SOW-0025, decision 3); say so when the change would leave it behind.
function warnAfterChange(previous: string, next: string, env: NodeJS.ProcessEnv, out: ConfigCommandOptions): void {
  if (previous !== next && existsSync(join(previous, 'data.db')) && !existsSync(join(next, 'data.db'))) {
    out.stderr(
      `Warning: your data in ${previous} was not moved. ` +
        `To keep it, stop the app and move everything inside ${previous} into ${next}.\n`,
    );
  }
  if (env.JOBTRACK_DATA_DIR) {
    out.stderr('Note: JOBTRACK_DATA_DIR is set and takes precedence over the config file.\n');
  }
}
