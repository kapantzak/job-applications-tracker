import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRuns } from '../api/client.js';
import type { Run } from '../../server/domain/types.js';
import { formatTime } from '../format.js';

export function RunsPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listRuns()
      .then((list) => {
        if (active) setRuns(list);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  if (!runs) return error ? <p role="alert">{error}</p> : <p>Loading...</p>;

  return (
    <section>
      <h1>Runs</h1>
      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Status</th>
            <th>Started</th>
            <th>Finished</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <Link to={`/runs/${r.id}`}>{r.kind}</Link>
              </td>
              <td>{r.status}</td>
              <td>{formatTime(r.started_at)}</td>
              <td>{formatTime(r.finished_at)}</td>
              <td>{r.summary ?? r.error ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
