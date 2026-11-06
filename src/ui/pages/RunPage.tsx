import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRun, getRunLog, subscribeRunEvents } from '../api/client.js';
import type { Run } from '../../server/domain/types.js';
import { LogView } from '../components/LogView.js';
import { formatTime } from '../format.js';

const NO_GMAIL = 'Your agent has no Gmail tool';

export function RunPage() {
  const { id = '' } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const fail = (e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : String(e));
    };
    setRun(null);
    setLines([]);
    setError(null);

    getRun(id)
      .then(async (initial) => {
        if (!active) return;
        setRun(initial);
        if (initial.status === 'queued' || initial.status === 'running') {
          // Subscribed once per mount; the client closes the stream itself after `done`.
          unsubscribe = subscribeRunEvents(
            id,
            (line) => {
              if (active) setLines((prev) => [...prev, line]);
            },
            () => {
              getRun(id)
                .then((fresh) => {
                  if (active) setRun(fresh);
                })
                .catch(fail);
            },
          );
        } else {
          const text = await getRunLog(id);
          if (active) setLines(text === '' ? [] : text.split('\n'));
        }
      })
      .catch(fail);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [id]);

  if (!run) return error ? <p role="alert">{error}</p> : <p>Loading...</p>;

  const terminal = run.status !== 'queued' && run.status !== 'running';
  const succeeded = run.status === 'succeeded';

  return (
    <section>
      <h1>Run</h1>
      <dl>
        <dt>Kind</dt>
        <dd>{run.kind}</dd>
        <dt>Status</dt>
        <dd>{run.status}</dd>
        <dt>Started</dt>
        <dd>{formatTime(run.started_at)}</dd>
        <dt>Finished</dt>
        <dd>{formatTime(run.finished_at)}</dd>
      </dl>
      {succeeded && run.summary && <p>{run.summary}</p>}
      {!succeeded && terminal && run.error && <p role="alert">{run.error}</p>}
      {error && <p role="alert">{error}</p>}
      {terminal && run.kind === 'discover_jobs' && <Link to="/jobs">View jobs</Link>}
      {terminal && run.kind === 'sync_mail' && <Link to="/review">Review proposals</Link>}
      {terminal && run.status === 'failed' && run.error?.startsWith(NO_GMAIL) && (
        <Link to="/settings">Open settings</Link>
      )}
      <LogView lines={lines} />
    </section>
  );
}
