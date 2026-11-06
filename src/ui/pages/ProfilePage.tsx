import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, getProfile, putProfile, type ProfileInput } from '../api/client.js';
import { TagInput } from '../components/TagInput.js';

const EMPTY: ProfileInput = {
  target_roles: [],
  locations: [],
  remote: 'any',
  seniority: '',
  keywords: [],
  excluded_companies: [],
  notes: '',
};

export function ProfilePage() {
  const [form, setForm] = useState<ProfileInput | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getProfile()
      .then((profile) => {
        if (!active) return;
        if (!profile) return setForm(EMPTY);
        const { created_at: _createdAt, ...rest } = profile;
        setForm(rest);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        setForm(EMPTY);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!form) return <p>Loading...</p>;

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) =>
    setForm({ ...form, [key]: value });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setError(null);
    if (form.target_roles.length === 0) {
      setError('Add at least one target role');
      return;
    }
    try {
      await putProfile(form);
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <h1>Profile</h1>
      <TagInput label="Target roles" value={form.target_roles} onChange={(v) => set('target_roles', v)} />
      <TagInput label="Locations" value={form.locations} onChange={(v) => set('locations', v)} />
      <label>
        Remote
        <select value={form.remote} onChange={(e) => set('remote', e.target.value as ProfileInput['remote'])}>
          <option value="any">Any</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On-site</option>
        </select>
      </label>
      <label>
        Seniority
        <input value={form.seniority} onChange={(e) => set('seniority', e.target.value)} />
      </label>
      <TagInput label="Keywords" value={form.keywords} onChange={(v) => set('keywords', v)} />
      <TagInput
        label="Excluded companies"
        value={form.excluded_companies}
        onChange={(v) => set('excluded_companies', v)}
      />
      <label>
        Notes
        <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </label>
      <button type="submit">Save</button>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
