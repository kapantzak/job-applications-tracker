import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { extractClaudeStructuredOutput, extractLastJsonObject } from './extract-json.js';
import type { AdapterHealth, AgentAdapter, AgentResult, AgentTask, CliAdapterConfig, RunOptions } from './types.js';

const KILL_GRACE_MS = 5000;
const CHECK_TIMEOUT_MS = 3000;
// A grandchild holding stdout open must not keep a run alive after the agent itself exits.
const CLOSE_GRACE_MS = 1000;

const PLACEHOLDER = /\{([a-z_]+)\}/g;

interface RunFiles {
  schema_file: string;
  prompt_file: string;
  output_file: string;
}

function expandArgv(
  argv: string[],
  schema: Record<string, unknown>,
  files: RunFiles,
  vars: Record<string, string> = {},
): string[] {
  const values: Record<string, string> = { ...vars, ...files };
  return argv.map((el) => {
    if (el === '{schema}') return JSON.stringify(schema);
    // Unknown placeholders are left as written so a custom command can contain literal braces.
    return el.replace(PLACEHOLDER, (m, name: string) => values[name] ?? m);
  });
}

function terminate(child: ChildProcess): NodeJS.Timeout | undefined {
  if (child.pid === undefined) return undefined;
  if (process.platform === 'win32') {
    // Agent CLIs on Windows are often shims; only taskkill /T reaches the real process tree.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on(
      'error',
      () => {},
    );
    return undefined;
  }
  child.kill('SIGTERM');
  return setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, KILL_GRACE_MS);
}

function streamLines(stream: Readable, sink: (chunk: string) => void, onLine: (line: string) => void): () => void {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    sink(chunk);
    pending += chunk;
    let nl: number;
    while ((nl = pending.indexOf('\n')) !== -1) {
      onLine(pending.slice(0, nl).replace(/\r$/, ''));
      pending = pending.slice(nl + 1);
    }
  });
  return () => {
    if (pending) onLine(pending.replace(/\r$/, ''));
    pending = '';
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createCliAdapter(config: CliAdapterConfig): AgentAdapter {
  async function check(): Promise<AdapterHealth> {
    const argv = config.versionArgv ?? [config.argv[0]!, '--version'];
    return new Promise((done) => {
      let stdout = '';
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      const finish = (h: Omit<AdapterHealth, 'id'>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        done({ id: config.id, ...h });
      };
      let child: ChildProcess;
      try {
        child = spawn(argv[0]!, argv.slice(1), {
          shell: false,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        // spawn throws synchronously for invalid argv (empty command, NUL byte, E2BIG).
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return done({ id: config.id, installed: false, message: 'Not found on PATH' });
        return done({ id: config.id, installed: true, message: `Failed to start: ${errorMessage(err)}` });
      }
      const timer = setTimeout(() => {
        killTimer = terminate(child);
        finish({ installed: true, message: `Timed out after ${CHECK_TIMEOUT_MS} ms` });
      }, CHECK_TIMEOUT_MS);
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (c: string) => (stdout += c));
      child.stderr!.resume();
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') finish({ installed: false, message: 'Not found on PATH' });
        else finish({ installed: true, message: errorMessage(err) });
      });
      child.on('close', (code, signal) => {
        clearTimeout(killTimer);
        if (code === 0) {
          const version = stdout.split('\n')[0]!.trim();
          finish({ installed: true, version: version || undefined });
        } else {
          finish({ installed: true, message: code === null ? `Killed by signal ${signal}` : `Exited with code ${code}` });
        }
      });
    });
  }

  async function run(task: AgentTask, opts: RunOptions): Promise<AgentResult> {
    const started = Date.now();
    const cwd = resolve(opts.cwd);
    const files: RunFiles = {
      schema_file: join(cwd, 'schema.json'),
      prompt_file: join(cwd, 'prompt.md'),
      output_file: join(cwd, 'output.json'),
    };
    let rawStdout = '';
    let rawStderr = '';
    const fail = (error: string, exitCode: number | null = null): AgentResult => ({
      ok: false,
      rawStdout,
      rawStderr,
      exitCode,
      durationMs: Date.now() - started,
      error,
    });

    if (opts.signal?.aborted) return fail('Aborted');
    let argv: string[];
    try {
      // prompt.md is written in every mode so a failed run can be inspected.
      writeFileSync(files.prompt_file, task.prompt);
      writeFileSync(files.schema_file, JSON.stringify(task.outputSchema, null, 2));
      // A stale output.json from an earlier attempt must not be mistaken for this run's result.
      rmSync(files.output_file, { force: true });
      argv = expandArgv(config.argv, task.outputSchema, files, config.vars);
      if (config.promptVia === 'argv') argv.push(task.prompt);
    } catch (err) {
      return fail(`Could not prepare run directory: ${errorMessage(err)}`);
    }

    const log = (line: string) => {
      try {
        opts.onLog?.(line);
      } catch {
        // A faulty log sink must not break the run.
      }
    };

    return new Promise((done) => {
      let settled = false;
      let stopReason: string | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      let closeTimer: NodeJS.Timeout | undefined;

      let child: ChildProcess;
      try {
        child = spawn(argv[0]!, argv.slice(1), {
          cwd,
          shell: false,
          env: process.env,
          stdio: [config.promptVia === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        // spawn throws synchronously for invalid argv (empty command, NUL byte, E2BIG); no timers are armed yet.
        return done(fail(`Failed to start: ${errorMessage(err)}`));
      }

      const flushOut = streamLines(child.stdout!, (c) => (rawStdout += c), log);
      const flushErr = streamLines(child.stderr!, (c) => (rawStderr += c), (l) => log(`[stderr] ${l}`));

      const stop = (reason: string) => {
        // An agent that already exited and is only waiting for its pipes to close is not timed out or aborted.
        if (settled || stopReason || child.exitCode !== null || child.signalCode !== null) return;
        stopReason = reason;
        killTimer = terminate(child);
      };
      const timer = setTimeout(() => stop(`Timed out after ${opts.timeoutMs} ms`), opts.timeoutMs);
      const onAbort = () => stop('Aborted');
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      const finish = (result: AgentResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        clearTimeout(closeTimer);
        opts.signal?.removeEventListener('abort', onAbort);
        flushOut();
        flushErr();
        done(result);
      };

      const complete = (code: number | null, signal: NodeJS.Signals | null) => {
        // Destroyed streams can still emit close after the grace timer already completed the run.
        if (settled) return;
        if (stopReason) return finish(fail(stopReason, code));
        if (code !== 0) return finish(fail(code === null ? `Killed by signal ${signal}` : `Exited with code ${code}`, code));
        try {
          const output = extract();
          finish({ ok: true, output, rawStdout, rawStderr, exitCode: code, durationMs: Date.now() - started });
        } catch (err) {
          finish(fail(errorMessage(err), code));
        }
      };

      const extract = (): unknown => {
        switch (config.resultFrom) {
          case 'claude-stream-json':
            return extractClaudeStructuredOutput(rawStdout);
          case 'stdout-json':
            return extractLastJsonObject(rawStdout);
          case 'output-file': {
            let text: string;
            try {
              text = readFileSync(files.output_file, 'utf8');
            } catch (err) {
              throw new Error(`Could not read output file: ${errorMessage(err)}`);
            }
            return extractLastJsonObject(text);
          }
        }
      };

      child.on('error', (err: NodeJS.ErrnoException) => {
        // Errors after a successful spawn (e.g. a failed kill) are not run failures.
        if (child.pid !== undefined) return;
        finish(fail(err.code === 'ENOENT' ? `Command not found: ${argv[0]}` : `Failed to start: ${err.message}`));
      });
      child.on('exit', (code, signal) => {
        if (settled) return;
        closeTimer = setTimeout(() => {
          child.stdout!.destroy();
          child.stderr!.destroy();
          complete(code, signal);
        }, CLOSE_GRACE_MS);
      });
      child.on('close', (code, signal) => complete(code, signal));

      if (config.promptVia === 'stdin' && child.stdin) {
        // EPIPE when the agent exits without reading is reported through the exit code instead.
        child.stdin.on('error', () => {});
        child.stdin.end(task.prompt);
      }
    });
  }

  return { id: config.id, check, run };
}
