import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { getApplication, patchApplication, type ApplicationDetail } from '../api/client.js';
import { TagInput } from '../components/TagInput.js';
import { formatTime } from '../format.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

export function ApplicationDetailPage() {
  const { id = '' } = useParams();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [appliedDate, setAppliedDate] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setApp(null);
    getApplication(id)
      .then((a) => {
        if (!active) return;
        setApp(a);
        setCompany(a.company);
        setRole(a.role);
        setUrl(a.url ?? '');
        setNotes(a.notes ?? '');
        setAppliedDate(toDateInput(a.applied_at));
        setDomains(a.sender_domains);
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [id]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await patchApplication(id, {
        company,
        role,
        url: url || null,
        notes: notes || null,
        sender_domains: domains,
        applied_at: appliedDate ? new Date(`${appliedDate}T00:00:00Z`).toISOString() : null,
      });
      setSaved(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (!app) return error ? <p role="alert">{error}</p> : <p>Loading...</p>;

  return (
    <section>
      <h1>
        {app.company} - {app.role}
      </h1>
      <form onSubmit={onSubmit}>
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
          Applied date
          <input type="date" value={appliedDate} onChange={(e) => setAppliedDate(e.target.value)} />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <TagInput label="Sender domains" value={domains} onChange={setDomains} placeholder="example.com" />
        <button type="submit" disabled={busy}>
          Save
        </button>
        {saved && <p role="status">Saved</p>}
        {error && <p role="alert">{error}</p>}
      </form>
      <h2>Status history</h2>
      <ul>
        {app.history.map((h) => (
          <li key={h.id}>
            {h.from_status ?? 'none'} → {h.to_status} ({h.source}, {formatTime(h.changed_at)})
          </li>
        ))}
      </ul>
    </section>
  );
}
