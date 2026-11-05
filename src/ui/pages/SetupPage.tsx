import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, getAdapters, getSettings, patchSettings, type AdapterStatus } from '../api/client.js';

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
      await patchSettings({ adapter_id: adapterId, custom_command: customCommand });
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  if (!adapters) {
    return error ? <p role="alert">{error}</p> : <p>Loading...</p>;
  }

  const selected = adapters.find((a) => a.id === adapterId);

  return (
    <form onSubmit={onSubmit}>
      <h1>Setup</h1>
      <fieldset>
        <legend>Agent adapter</legend>
        {adapters.map((a) => (
          <label key={a.id}>
            <input
              type="radio"
              name="adapter"
              value={a.id}
              checked={adapterId === a.id}
              onChange={() => setAdapterId(a.id)}
            />
            {a.id} - {a.installed ? `installed ${a.version ?? ''}`.trim() : 'not installed'}
            {a.message ? ` (${a.message})` : ''}
          </label>
        ))}
      </fieldset>
      {adapterId === 'custom' && (
        <label>
          Custom command
          <input value={customCommand} onChange={(e) => setCustomCommand(e.target.value)} />
        </label>
      )}
      {selected?.gmail_guide && (
        <section>
          <h2>Gmail access</h2>
          <p>
            This agent needs a Gmail MCP server configured to read your mailbox.{' '}
            <a href="README.md#gmail-access-for-other-agents">Gmail setup guide</a>
          </p>
        </section>
      )}
      <button type="submit">Save</button>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
