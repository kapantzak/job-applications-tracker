import { existsSync, readFileSync } from 'node:fs';
import { win32 } from 'node:path';

export interface ResolveDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (p: string) => boolean;
  readFile: (p: string) => string;
  execPath: string;
  // Joins the shim's directory with its script reference; a test seam so a shim can point at a real file off Windows.
  join?: (...parts: string[]) => string;
}

export interface ResolvedCommand {
  file: string;
  prefixArgs: string[];
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD;.JS';
// npm's cmd-shim launches its entry as "%dp0%\node_modules\<pkg>\<entry>.js"; older shims use %~dp0.
// A quoted reference may contain spaces, so it is tried first; the unquoted form stops at whitespace.
// The lookahead keeps "package.json" from matching as "package.js".
const QUOTED_SHIM_SCRIPT = /"%~?dp0%?\\([^"]+?\.(?:m|c)?js)"/i;
const SHIM_SCRIPT = /"?%~?dp0%?\\?([^"\s]+\.(?:m|c)?js)(?![^"\s])"?/i;
const SCRIPT_EXTS = new Set(['.js', '.mjs', '.cjs']);

export function defaultResolveDeps(): ResolveDeps {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    readFile: (p) => readFileSync(p, 'utf8'),
    execPath: process.execPath,
  };
}

// spawn() without a shell cannot run .cmd/.bat files, so on Windows an npm shim is replaced by
// `node <entry.js>`. Anything unresolvable is returned unchanged so spawn reports ENOENT as before.
export function resolveCommand(argv0: string, deps: ResolveDeps): ResolvedCommand {
  const unchanged: ResolvedCommand = { file: argv0, prefixArgs: [] };
  if (deps.platform !== 'win32') return unchanged;

  const winner = candidates(argv0, deps.env).find((c) => deps.exists(c));
  if (winner === undefined) return unchanged;

  const ext = win32.extname(winner).toLowerCase();
  if (SCRIPT_EXTS.has(ext)) return { file: deps.execPath, prefixArgs: [winner] };
  if (ext !== '.cmd' && ext !== '.bat') return { file: winner, prefixArgs: [] };

  let text: string;
  try {
    text = deps.readFile(winner);
  } catch {
    return unchanged;
  }
  const match = QUOTED_SHIM_SCRIPT.exec(text) ?? SHIM_SCRIPT.exec(text);
  if (!match) return unchanged;
  const join = deps.join ?? win32.join;
  return { file: deps.execPath, prefixArgs: [join(win32.dirname(winner), match[1]!)] };
}

function candidates(argv0: string, env: NodeJS.ProcessEnv): string[] {
  if (/[\\/]/.test(argv0) || win32.extname(argv0) !== '') return [argv0];
  const dirs = (env.PATH ?? '').split(';').filter(Boolean);
  const exts = (env.PATHEXT ?? DEFAULT_PATHEXT).split(';').filter(Boolean);
  return dirs.flatMap((dir) => exts.map((ext) => win32.join(dir, argv0 + ext)));
}
