import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chooseDataDirOnFirstRun,
  cleanAnswer,
  createTerminalPrompt,
  PromptCancelledError,
} from '../../../src/server/config/first-run.js';
import { configFilePath, writeConfig } from '../../../src/server/config/paths.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'jobtrack-first-run-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function harness(answers: string[]) {
  const asked: string[] = [];
  let out = '';
  return {
    asked,
    out: () => out,
    ask: async (q: string) => {
      asked.push(q);
      const next = answers.shift();
      if (next === undefined) throw new Error('no more answers');
      return next;
    },
    write: (text: string) => {
      out += text;
    },
  };
}

const defaultDir = () => join(home, '.job-applications-tracker');
const savedConfig = () => JSON.parse(readFileSync(configFilePath(home), 'utf8')) as unknown;

describe('chooseDataDirOnFirstRun', () => {
  it('saves the default when the user presses Enter', async () => {
    const h = harness(['']);
    const chosen = await chooseDataDirOnFirstRun({ env: {}, home, interactive: true, ask: h.ask, write: h.write });
    expect(chosen).toBe(defaultDir());
    expect(savedConfig()).toEqual({ dataDir: defaultDir() });
    expect(statSync(defaultDir()).isDirectory()).toBe(true);
    expect(h.out()).toContain(`Press Enter to use ${defaultDir()}`);
    expect(h.out()).toContain(`Saved in ${configFilePath(home)}.`);
    expect(h.asked).toHaveLength(1);
  });

  it('saves a typed folder with ~ expanded and creates it', async () => {
    const h = harness(['  ~/Documents/jobs  ']);
    const chosen = await chooseDataDirOnFirstRun({ env: {}, home, interactive: true, ask: h.ask, write: h.write });
    const expected = join(home, 'Documents', 'jobs');
    expect(chosen).toBe(expected);
    expect(savedConfig()).toEqual({ dataDir: expected });
    expect(statSync(expected).isDirectory()).toBe(true);
  });

  it('saves a quoted answer as the folder inside the quotes', async () => {
    const h = harness(["'~/My Jobs'"]);
    const chosen = await chooseDataDirOnFirstRun({ env: {}, home, interactive: true, ask: h.ask, write: h.write });
    expect(chosen).toBe(join(home, 'My Jobs'));
    expect(savedConfig()).toEqual({ dataDir: join(home, 'My Jobs') });
  });

  it('asks again when the answer is a file, and saves the next valid folder', async () => {
    const file = join(home, 'a-file');
    writeFileSync(file, 'x');
    const good = join(home, 'good');
    const h = harness([file, good]);
    const chosen = await chooseDataDirOnFirstRun({ env: {}, home, interactive: true, ask: h.ask, write: h.write });
    expect(chosen).toBe(good);
    expect(h.asked).toHaveLength(2);
    expect(h.out()).toContain(`${file} is a file, not a folder. Choose another folder.`);
    expect(savedConfig()).toEqual({ dataDir: good });
  });

  it('does not ask or write without an interactive terminal', async () => {
    const h = harness([]);
    expect(
      await chooseDataDirOnFirstRun({ env: {}, home, interactive: false, ask: h.ask, write: h.write }),
    ).toBeNull();
    expect(h.asked).toHaveLength(0);
    expect(existsSync(configFilePath(home))).toBe(false);
  });

  it('does not ask or write when the flag or JOBTRACK_DATA_DIR is set', async () => {
    const h = harness([]);
    const base = { home, interactive: true, ask: h.ask, write: h.write };
    expect(await chooseDataDirOnFirstRun({ ...base, flag: join(home, 'f'), env: {} })).toBeNull();
    expect(await chooseDataDirOnFirstRun({ ...base, env: { JOBTRACK_DATA_DIR: join(home, 'e') } })).toBeNull();
    expect(h.asked).toHaveLength(0);
    expect(existsSync(configFilePath(home))).toBe(false);
  });

  it('does not ask when a config file exists, even one without dataDir', async () => {
    const h = harness([]);
    writeConfig({}, home);
    expect(
      await chooseDataDirOnFirstRun({ env: {}, home, interactive: true, ask: h.ask, write: h.write }),
    ).toBeNull();
    expect(h.asked).toHaveLength(0);
    expect(savedConfig()).toEqual({});
  });

  it('does not ask an existing user whose default folder already holds data.db', async () => {
    mkdirSync(defaultDir());
    writeFileSync(join(defaultDir(), 'data.db'), '');
    const h = harness([]);
    expect(
      await chooseDataDirOnFirstRun({ env: {}, home, interactive: true, ask: h.ask, write: h.write }),
    ).toBeNull();
    expect(h.asked).toHaveLength(0);
    expect(existsSync(configFilePath(home))).toBe(false);
  });
});

describe('cleanAnswer', () => {
  it('trims, strips one pair of matching outer quotes and unescapes spaces', () => {
    expect(cleanAnswer('  /a/b  ', 'darwin')).toBe('/a/b');
    expect(cleanAnswer("'~/My Jobs'", 'darwin')).toBe('~/My Jobs');
    expect(cleanAnswer('"/a/My Jobs"', 'linux')).toBe('/a/My Jobs');
    expect(cleanAnswer('/Users/x/My\\ Jobs\\ 2026', 'darwin')).toBe('/Users/x/My Jobs 2026');
  });

  it('leaves unmatched quotes and Windows backslashes alone', () => {
    expect(cleanAnswer("'/a/b", 'darwin')).toBe("'/a/b");
    expect(cleanAnswer('\'/a/b"', 'darwin')).toBe('\'/a/b"');
    expect(cleanAnswer("'", 'darwin')).toBe("'");
    expect(cleanAnswer('C:\\Data\\ jobs', 'win32')).toBe('C:\\Data\\ jobs');
  });
});

describe('createTerminalPrompt', () => {
  async function promptShown(output: PassThrough, text: string): Promise<void> {
    let seen = '';
    await new Promise<void>((res) => {
      const onData = (d: Buffer) => {
        seen += d.toString();
        if (seen.includes(text)) {
          output.off('data', onData);
          res();
        }
      };
      output.on('data', onData);
    });
  }

  it('returns the typed line', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompt = createTerminalPrompt(input, output);
    const shown = promptShown(output, 'Folder: ');
    const answer = prompt.ask('Folder: ');
    await shown;
    input.write('/data/x\n');
    await expect(answer).resolves.toBe('/data/x');
    prompt.close();
  });

  it('rejects with PromptCancelledError when the input ends', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompt = createTerminalPrompt(input, output);
    const shown = promptShown(output, 'Folder: ');
    const answer = prompt.ask('Folder: ');
    await shown;
    input.end();
    await expect(answer).rejects.toBeInstanceOf(PromptCancelledError);
    await expect(answer).rejects.toThrow('No data directory chosen.');
    prompt.close();
  });
});
