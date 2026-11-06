import { useState, type FormEvent } from 'react';
import type { Application, ApplicationStatus } from '../../server/domain/types.js';
import { createApplication } from '../api/client.js';
import { StatusSelect } from './StatusSelect.js';

export function AddApplicationForm({ onCreated }: { onCreated: (app: Application) => void }) {
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<ApplicationStatus>('applied');
  const [appliedDate, setAppliedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createApplication({
        company,
        role,
        url: url || null,
        status,
        // Date inputs carry no time zone; pin to midnight UTC for a stable value. Without a date the key
        // is omitted so the server's default (applied means now) applies.
        ...(appliedDate ? { applied_at: new Date(`${appliedDate}T00:00:00Z`).toISOString() } : {}),
        notes,
      });
      onCreated(created);
      setCompany('');
      setRole('');
      setUrl('');
      setAppliedDate('');
      setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <h2>Add application</h2>
      <label>
        Company
        <input value={company} onChange={(e) => setCompany(e.target.value)} required />
      </label>
      <label>
        Role
        <input value={role} onChange={(e) => setRole(e.target.value)} required />
      </label>
      <label>
        URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label>
        Status
        <StatusSelect value={status} onChange={setStatus} />
      </label>
      <label>
        Applied date
        <input type="date" value={appliedDate} onChange={(e) => setAppliedDate(e.target.value)} />
      </label>
      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Add application
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
