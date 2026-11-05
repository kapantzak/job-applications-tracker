import { useState } from 'react';
import { purgeRunLogs } from '../api/client.js';

export function DataSection({ dataDir }: { dataDir: string | null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const purge = async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const { deleted } = await purgeRunLogs();
      setResult(`Deleted ${deleted} log files`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Data">
      <h2>Data</h2>
      <p>
        Data directory: <code>{dataDir ?? '-'}</code>
      </p>
      <button type="button" disabled={busy} onClick={purge}>
        Purge run logs
      </button>
      {result && <p role="status">{result}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
