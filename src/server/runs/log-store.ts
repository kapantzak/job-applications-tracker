import { appendFileSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export type LogListener = (line: string) => void;

// Run ids are UUIDs; rejecting anything else keeps ids from escaping runsDir.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function createLogStore(runsDir: string) {
  const listeners = new Map<string, Set<LogListener>>();

  function fileFor(runId: string): string {
    if (!SAFE_ID.test(runId)) throw new Error(`Invalid run id: ${runId}`);
    return join(runsDir, `${runId}.log`);
  }

  function append(runId: string, line: string): void {
    appendFileSync(fileFor(runId), `${line}\n`);
    const set = listeners.get(runId);
    if (!set) return;
    // Copy so a listener may unsubscribe while being notified.
    for (const cb of [...set]) {
      try {
        cb(line);
      } catch {
        // A broken subscriber (e.g. a closed SSE stream) must not break the run's logging.
      }
    }
  }

  function read(runId: string): string {
    try {
      return readFileSync(fileFor(runId), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    }
  }

  function subscribe(runId: string, cb: LogListener): () => void {
    let set = listeners.get(runId);
    if (!set) {
      set = new Set();
      listeners.set(runId, set);
    }
    set.add(cb);
    return () => {
      const current = listeners.get(runId);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) listeners.delete(runId);
    };
  }

  // Deletes top-level *.log files and per-run directories (prompt, schema, output files) for every
  // run not in `keep`. Returns the number of log files plus directories removed. Directories whose
  // name is not a run id are left alone.
  function purge(keep: Set<string>): number {
    let removed = 0;
    let entries;
    try {
      entries = readdirSync(runsDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw err;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SAFE_ID.test(entry.name) || keep.has(entry.name)) continue;
        rmSync(join(runsDir, entry.name), { recursive: true, force: true });
        removed++;
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
      if (keep.has(entry.name.slice(0, -'.log'.length))) continue;
      unlinkSync(join(runsDir, entry.name));
      removed++;
    }
    return removed;
  }

  // Deletes the log file and run directory of each given run (profile delete). Missing ones are skipped.
  function remove(runIds: string[]): void {
    for (const runId of runIds) {
      rmSync(fileFor(runId), { force: true });
      rmSync(join(runsDir, runId), { recursive: true, force: true });
    }
  }

  return { append, read, subscribe, purge, remove };
}

export type LogStore = ReturnType<typeof createLogStore>;
