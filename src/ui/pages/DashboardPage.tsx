import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Run, RunKind } from '../../server/domain/types.js';
import {
  listApplications,
  listJobs,
  listProposals,
  listRuns,
  startDiscovery,
  startSync,
} from '../api/client.js';
import { formatTime } from '../format.js';

interface Stats {
  applications: number | null;
  proposals: number | null;
  jobs: number | null;
  runs: Run[] | null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function lastSuccess(runs: Run[] | null, kind: RunKind): string {
  if (!runs) return '–';
  const run = runs.find((r) => r.kind === kind && r.status === 'succeeded');
  return run ? formatTime(run.finished_at ?? run.created_at) : 'never';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.allSettled([listApplications(true), listProposals(), listJobs(), listRuns()]).then(
      ([apps, proposals, jobs, runs]) => {
        if (!active) return;
        const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
        setStats({
          applications: value(apps)?.length ?? null,
          proposals: value(proposals)?.length ?? null,
          jobs: value(jobs)?.length ?? null,
          runs: value(runs),
        });
        setErrors(
          [apps, proposals, jobs, runs].flatMap((r) => (r.status === 'rejected' ? [message(r.reason)] : [])),
        );
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const start = async (action: typeof startDiscovery) => {
    setBusy(true);
    try {
      const run = await action();
      navigate(`/runs/${run.id}`);
    } catch (e) {
      setErrors([message(e)]);
      setBusy(false);
    }
  };

  if (!stats) return <p>Loading...</p>;
  const show = (n: number | null) => (n === null ? '–' : n);

  return (
    <section>
      <h1>Dashboard</h1>
      {errors.map((e) => (
        <p key={e} role="alert">
          {e}
        </p>
      ))}
      <div className="stats">
        <p>
          Open applications{' '}
          <strong className="stat" data-testid="count-applications">
            {show(stats.applications)}
          </strong>
        </p>
        <p>
          Pending proposals{' '}
          <strong className="stat" data-testid="count-proposals">
            {show(stats.proposals)}
          </strong>
        </p>
        <p>
          Jobs{' '}
          <strong className="stat" data-testid="count-jobs">
            {show(stats.jobs)}
          </strong>
        </p>
      </div>
      <p>Last discovery: {lastSuccess(stats.runs, 'discover_jobs')}</p>
      <p>Last sync: {lastSuccess(stats.runs, 'sync_mail')}</p>
      <button type="button" disabled={busy} onClick={() => start(startDiscovery)}>
        Find jobs
      </button>{' '}
      <button type="button" disabled={busy} onClick={() => start(startSync)}>
        Sync from Gmail
      </button>
    </section>
  );
}
