import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { Run, RunStatus } from '../domain/types.js';
import { HttpError, parseWith } from './errors.js';

const DEFAULT_SSE_POLL_MS = 1000;

const LimitQuery = z.coerce.number().int().min(1).max(200);

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export function createRunsRouter(deps: AppDeps): Hono {
  const router = new Hono();
  const pollMs = deps.ssePollMs ?? DEFAULT_SSE_POLL_MS;

  // Checked before any log-store call: the store throws on ids it considers unsafe.
  function requireRun(id: string): Run {
    const run = deps.runsRepo.get(id);
    if (!run) throw new HttpError(404, 'Run not found');
    return run;
  }

  // Returns the final status, or null while the run can still produce output.
  function finalStatus(id: string): RunStatus | 'unknown' | null {
    const status = deps.runsRepo.get(id)?.status;
    if (status === 'queued' || status === 'running') return null;
    return status ?? 'unknown';
  }

  router.get('/', (c) => {
    const raw = c.req.query('limit');
    const limit = raw === undefined ? 50 : parseWith(LimitQuery, raw);
    return c.json(deps.runsRepo.list(limit));
  });

  router.post('/discover', (c) => {
    if (!deps.profileRepo.get()) throw new HttpError(422, 'Profile is not set');
    return c.json(deps.queue.enqueue('discover_jobs'), 202);
  });

  router.post('/sync', (c) => c.json(deps.queue.enqueue('sync_mail'), 202));

  router.delete('/logs', (c) => {
    // The repo has no "all active runs" query; this read-only one keeps live logs intact.
    const active = deps.db
      .prepare("SELECT id FROM runs WHERE status IN ('queued', 'running')")
      .all() as { id: string }[];
    const deleted = deps.logStore.purge(new Set(active.map((r) => r.id)));
    return c.json({ deleted });
  });

  router.get('/:id', (c) => c.json(requireRun(c.req.param('id'))));

  router.get('/:id/log', (c) => {
    const run = requireRun(c.req.param('id'));
    return c.text(deps.logStore.read(run.id));
  });

  router.get('/:id/events', (c) => {
    const { id } = requireRun(c.req.param('id'));
    return streamSSE(c, async (stream) => {
      let closed = false;
      let aborted = false;
      let unsubscribe: () => void = () => {};
      let timer: NodeJS.Timeout | undefined;
      let release!: () => void;
      const ended = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Writes are chained so lines reach the client in log order.
      let chain: Promise<void> = Promise.resolve();
      const send = (event: string, data: string): void => {
        chain = chain.then(() => stream.writeSSE({ event, data }));
      };
      const close = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (timer) clearInterval(timer);
        release();
      };
      const finishWith = (status: string): void => {
        if (closed) return;
        send('done', status);
        close();
      };

      stream.onAbort(() => {
        aborted = true;
        close();
      });

      // Replay, status check and subscribe run synchronously, so no line can fall between them.
      for (const line of splitLines(deps.logStore.read(id))) send('line', line);
      const initial = finalStatus(id);
      if (initial) {
        finishWith(initial);
      } else {
        unsubscribe = deps.logStore.subscribe(id, (line) => send('line', line));
        // Status polling, not the queue's final log line, decides the end: handlers may log after it.
        timer = setInterval(() => {
          try {
            const status = finalStatus(id);
            if (status) finishWith(status);
          } catch (err) {
            console.error(`run ${id}: event stream stopped: ${err instanceof Error ? err.message : err}`);
            close();
          }
        }, pollMs);
      }

      await ended;
      if (!aborted) await chain;
    });
  });

  return router;
}
