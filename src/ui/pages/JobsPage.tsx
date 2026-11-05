import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError,
  dismissJob,
  listJobs,
  markApplied,
  saveJob,
  startDiscovery,
} from '../api/client.js';
import type { Job } from '../../server/domain/types.js';
import { VerificationBadge } from '../components/VerificationBadge.js';

// Job URLs come from an agent and are untrusted; never render javascript: and similar schemes.
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

export function JobsPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [includeDead, setIncludeDead] = useState(false);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [done, setDone] = useState<Record<string, 'Saved' | 'Applied'>>({});
  const [error, setError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    listJobs({ includeDead, includeDismissed })
      .then((list) => {
        if (active) setJobs(list);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [includeDead, includeDismissed, reloadTick]);

  const run = useCallback(async (action: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await action();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onFind = async () => {
    setError(null);
    setNeedsProfile(false);
    try {
      const started = await startDiscovery();
      navigate(`/runs/${started.id}`);
    } catch (e) {
      // Other 422s (e.g. agent not installed) carry their own message and must be shown as is.
      if (e instanceof ApiError && e.status === 422 && e.message === 'Profile is not set') setNeedsProfile(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <h1>Jobs</h1>
      <button type="button" onClick={onFind}>
        Find jobs
      </button>
      {needsProfile && (
        <p role="alert">
          Fill in your profile first: <Link to="/profile">Open profile</Link>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div>
        <label>
          <input type="checkbox" checked={includeDead} onChange={(e) => setIncludeDead(e.target.checked)} />
          Show dead links
        </label>{' '}
        <label>
          <input
            type="checkbox"
            checked={includeDismissed}
            onChange={(e) => setIncludeDismissed(e.target.checked)}
          />
          Show dismissed
        </label>
      </div>
      {!jobs ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Title</th>
              <th>Location</th>
              <th>Source</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const href = job.canonical_url || job.url;
              return (
                <tr key={job.id}>
                  <td>{job.company}</td>
                  <td>{job.title}</td>
                  <td>{job.location ?? '–'}</td>
                  <td>{job.source_site ?? '–'}</td>
                  <td>
                    <VerificationBadge status={job.verification_status} />
                  </td>
                  <td>
                    {isHttpUrl(href) && (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        Open
                      </a>
                    )}{' '}
                    {done[job.id] ? (
                      <span>{done[job.id]}</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => run(() => saveJob(job.id), () => setDone((d) => ({ ...d, [job.id]: 'Saved' })))}
                        >
                          Save
                        </button>{' '}
                        <button
                          type="button"
                          onClick={() =>
                            run(() => markApplied(job.id), () => setDone((d) => ({ ...d, [job.id]: 'Applied' })))
                          }
                        >
                          Mark applied
                        </button>{' '}
                      </>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => run(() => dismissJob(job.id), () => setReloadTick((t) => t + 1))}
                    >
                      Dismiss
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
