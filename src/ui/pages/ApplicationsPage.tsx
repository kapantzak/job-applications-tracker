import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Application, ApplicationStatus } from '../../server/domain/types.js';
import { listApplications, setApplicationStatus, startSync } from '../api/client.js';
import { AddApplicationForm } from '../components/AddApplicationForm.js';
import { StatusSelect } from '../components/StatusSelect.js';
import { formatTime } from '../format.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
// Stored URLs are untrusted; never render javascript: and friends as links.
const isHttp = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);

export function ApplicationsPage() {
  const navigate = useNavigate();
  const [apps, setApps] = useState<Application[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listApplications()
      .then((list) => {
        if (active) setApps(list);
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, []);

  const changeStatus = async (id: string, next: ApplicationStatus) => {
    setBusyId(id);
    setError(null);
    try {
      const updated = await setApplicationStatus(id, next);
      setApps((prev) => prev?.map((a) => (a.id === id ? updated : a)) ?? null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusyId(null);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const run = await startSync();
      navigate(`/runs/${run.id}`);
    } catch (e) {
      setError(message(e));
      setSyncing(false);
    }
  };

  return (
    <section>
      <h1>Applications</h1>
      <button type="button" disabled={syncing} onClick={sync}>
        Sync from Gmail
      </button>
      {error && <p role="alert">{error}</p>}
      {!apps ? (
        !error && <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Role</th>
              <th>Status</th>
              <th>Applied</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td>{a.company}</td>
                <td>{a.role}</td>
                <td>
                  <StatusSelect
                    value={a.status}
                    disabled={busyId === a.id}
                    onChange={(next) => changeStatus(a.id, next)}
                  />
                </td>
                <td>{formatTime(a.applied_at)}</td>
                <td>
                  <Link to={`/applications/${a.id}`}>Details</Link>{' '}
                  {isHttp(a.url) && (
                    <a href={a.url} target="_blank" rel="noopener noreferrer">
                      Open posting
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AddApplicationForm onCreated={(created) => setApps((prev) => [created, ...(prev ?? [])])} />
    </section>
  );
}
