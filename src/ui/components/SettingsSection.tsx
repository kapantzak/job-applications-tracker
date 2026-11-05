import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { patchSettings } from '../api/client.js';
import type { Settings } from '../../server/domain/types.js';

interface SettingsSectionProps {
  title: string;
  // Only this section's keys, so a validation error elsewhere cannot block the save.
  getPatch: () => Partial<Settings>;
  children: ReactNode;
}

export function SettingsSection({ title, getPatch, children }: SettingsSectionProps) {
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await patchSettings(getPatch());
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <form onSubmit={onSubmit}>
        {children}
        <button type="submit" disabled={busy}>
          Save
        </button>
        {saved && <p role="status">Saved</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
