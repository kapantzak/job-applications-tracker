import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_DIR_NAME = '.job-applications-tracker';

export interface ResolveDataDirOptions {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

// Precedence: --data-dir flag, then JOBTRACK_DATA_DIR, then ~/.job-applications-tracker.
// Empty values count as unset so a blank env var does not point the app at the cwd.
export function resolveDataDir(opts: ResolveDataDirOptions): string {
  const env = opts.env ?? process.env;
  if (opts.flag) return resolve(opts.flag);
  if (env.JOBTRACK_DATA_DIR) return resolve(env.JOBTRACK_DATA_DIR);
  return join(opts.home ?? homedir(), DEFAULT_DIR_NAME);
}

export function ensureDataDir(dir: string): { dbFile: string; runsDir: string } {
  const runsDir = join(dir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  return { dbFile: join(dir, 'data.db'), runsDir };
}
