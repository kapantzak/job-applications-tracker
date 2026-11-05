import { useEffect, useState } from 'react';
import type { Settings } from '../../server/domain/types.js';
import { getAdapters, getHealth, getSettings, type AdapterStatus } from '../api/client.js';
import { AdapterChooser } from '../components/AdapterChooser.js';
import { DataSection } from '../components/DataSection.js';
import { SettingsSection } from '../components/SettingsSection.js';

type TextKey =
  | 'permission_mode_discover'
  | 'permission_mode_sync'
  | 'allowed_tools_discover'
  | 'allowed_tools_sync'
  | 'sandbox_discover'
  | 'sandbox_sync';

const PERMISSION_FIELDS: Array<[TextKey, string]> = [
  ['permission_mode_discover', 'Permission mode (discover)'],
  ['permission_mode_sync', 'Permission mode (sync)'],
  ['allowed_tools_discover', 'Allowed tools (discover)'],
  ['allowed_tools_sync', 'Allowed tools (sync)'],
  ['sandbox_discover', 'Sandbox (discover)'],
  ['sandbox_sync', 'Sandbox (sync)'],
];

export function SettingsPage() {
  const [adapters, setAdapters] = useState<AdapterStatus[] | null>(null);
  const [values, setValues] = useState<Settings | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getAdapters(), getSettings(), getHealth()])
      .then(([list, settings, health]) => {
        if (!active) return;
        setAdapters(list);
        setValues(settings);
        setDataDir(health.dataDir);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  if (!adapters || !values) return error ? <p role="alert">{error}</p> : <p>Loading...</p>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <div>
      <h1>Settings</h1>
      <SettingsSection
        title="Agent"
        getPatch={() => ({
          adapter_id: values.adapter_id,
          custom_command: values.custom_command,
        })}
      >
        <AdapterChooser
          adapters={adapters}
          adapterId={values.adapter_id}
          customCommand={values.custom_command}
          onAdapterChange={(id) => set('adapter_id', id)}
          onCustomCommandChange={(v) => set('custom_command', v)}
        />
      </SettingsSection>
      <SettingsSection
        title="Permissions"
        getPatch={() => Object.fromEntries(PERMISSION_FIELDS.map(([key]) => [key, values[key]]))}
      >
        {PERMISSION_FIELDS.map(([key, label]) => (
          <label key={key}>
            {label}
            <input value={values[key]} onChange={(e) => set(key, e.target.value)} />
          </label>
        ))}
      </SettingsSection>
      <SettingsSection
        title="Runs"
        getPatch={() => ({
          run_timeout_ms: values.run_timeout_ms,
          sync_interval: values.sync_interval,
        })}
      >
        <label>
          Run timeout (ms)
          <input
            type="number"
            value={values.run_timeout_ms}
            onChange={(e) => set('run_timeout_ms', Number(e.target.value))}
          />
        </label>
        <label>
          Sync interval
          <select
            value={values.sync_interval}
            onChange={(e) => set('sync_interval', e.target.value as Settings['sync_interval'])}
          >
            {['off', '1h', '6h', '24h'].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </SettingsSection>
      <SettingsSection title="Server" getPatch={() => ({ port: values.port })}>
        <label>
          Port
          <input type="number" value={values.port} onChange={(e) => set('port', Number(e.target.value))} />
        </label>
        <p>Port changes take effect on restart.</p>
      </SettingsSection>
      <DataSection dataDir={dataDir} />
    </div>
  );
}
