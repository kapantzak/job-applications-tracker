import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  configFilePath,
  DataDirError,
  defaultDataDir,
  expandHome,
  locateDataDir,
  prepareDataDir,
  readConfig,
  writeConfig,
} from './paths.js';

export class PromptCancelledError extends Error {}

export interface FirstRunOptions {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  // True only when stdin and stdout are terminals; scripts and CI must never block on a question.
  interactive: boolean;
  ask: (question: string) => Promise<string>;
  write: (text: string) => void;
}

// Asks once where to keep data (SOW-0025, decisions 2, 7, 10). Returns the saved folder, or null when
// nothing was asked: not a terminal, a flag or env var set, a config file present (an answer or an
// unset), or an existing user whose default folder already holds a database.
export async function chooseDataDirOnFirstRun(opts: FirstRunOptions): Promise<string | null> {
  if (!opts.interactive) return null;
  const home = opts.home ?? homedir();
  const located = locateDataDir({ flag: opts.flag, env: opts.env, home });
  if (located.source === 'flag' || located.source === 'env') return null;
  if (readConfig(home) !== null) return null;
  const fallback = defaultDataDir(home);
  if (existsSync(join(fallback, 'data.db'))) return null;

  opts.write(
    'Where should Job Applications Tracker keep its data?\n' +
      `Press Enter to use ${fallback}, or type another folder.\n`,
  );
  for (;;) {
    const answer = cleanAnswer(await opts.ask('Folder: '));
    const dir = answer === '' ? fallback : resolve(expandHome(answer, home));
    try {
      prepareDataDir(dir);
    } catch (err) {
      if (!(err instanceof DataDirError)) throw err;
      opts.write(`${err.message} Choose another folder.\n`);
      continue;
    }
    // Saved even when it is the default, so the question is never asked again (decision 10).
    writeConfig({ dataDir: dir }, home);
    opts.write(
      `Saved in ${configFilePath(home)}. Change it later with "jobtrack config set data-dir <path>".\n`,
    );
    return dir;
  }
}

// Pasted paths arrive quoted or with escaped spaces (dragging a folder into macOS Terminal gives
// "/Users/x/My\ Jobs"); a saved answer sticks, so undo both (SOW-0025, decision 12). Windows paths keep
// their backslashes.
export function cleanAnswer(raw: string, platform: NodeJS.Platform = process.platform): string {
  let answer = raw.trim();
  const first = answer[0];
  if (answer.length >= 2 && (first === "'" || first === '"') && answer.endsWith(first)) {
    answer = answer.slice(1, -1);
  }
  return platform === 'win32' ? answer : answer.replaceAll('\\ ', ' ');
}

export interface TerminalPrompt {
  ask(question: string): Promise<string>;
  close(): void;
}

// Ctrl-C and end of input both cancel a pending question; without the SIGINT listener readline would
// only pause and leave the question hanging.
export function createTerminalPrompt(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): TerminalPrompt {
  const rl = createInterface({ input, output });
  const cancel = new AbortController();
  rl.on('SIGINT', () => cancel.abort());
  rl.on('close', () => cancel.abort());
  return {
    async ask(question) {
      try {
        return await rl.question(question, { signal: cancel.signal });
      } catch (err) {
        if (cancel.signal.aborted) throw new PromptCancelledError('No data directory chosen.');
        throw err;
      }
    },
    close() {
      rl.close();
    },
  };
}
