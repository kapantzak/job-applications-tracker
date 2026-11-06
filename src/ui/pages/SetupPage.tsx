import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, getAdapters, getSettings, patchSettings, type AdapterStatus } from '../api/client.js';
import { AdapterChooser } from '../components/AdapterChooser.js';

type AdapterId = AdapterStatus['id'];

export function SetupPage() {
  const [adapters, setAdapters] = useState<AdapterStatus[] | null>(null);
  const [adapterId, setAdapterId] = useState<AdapterId>('claude');
  const [customCommand, setCustomCommand] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getAdapters(), getSettings()])
      .then(([list, settings]) => {
        if (!active) return;
        setAdapters(list);
        setAdapterId(settings.adapter_id);
        setCustomCommand(settings.custom_command);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setError(null);
    try {
      await patchSettings({
        adapter_id: adapterId,
        custom_command: customCommand,
      });
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  if (!adapters) {
    return error ? <p role="alert">{error}</p> : <p>Loading...</p>;
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Setup</h1>
      <AdapterChooser
        adapters={adapters}
        adapterId={adapterId}
        customCommand={customCommand}
        onAdapterChange={setAdapterId}
        onCustomCommandChange={setCustomCommand}
      />
      <button type="submit">Save</button>
      {status && <p role="status">{status}</p>}
      {status === 'Saved' && <Link to="/profile">Continue to Profile</Link>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
