import { useEffect, useId, useState } from 'react';
import type { Settings } from '../../server/domain/types.js';
import {
  getAdapters,
  getHealth,
  getModelCatalogs,
  getSettings,
  type AdapterStatus,
  type ModelCatalogs,
} from '../api/client.js';
import { AGENT_CHOICE_KEYS } from '../agent-choices.js';
import { AdapterChooser } from '../components/AdapterChooser.js';
import { AgentModelFields } from '../components/AgentModelFields.js';
import { DataSection } from '../components/DataSection.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { SettingsSection } from '../components/SettingsSection.js';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

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
  const id = useId();
  const [adapters, setAdapters] = useState<AdapterStatus[] | null>(null);
  const [values, setValues] = useState<Settings | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<ModelCatalogs | null>(null);
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
    // Suggestions only: without them the model fields are plain text, so a failure is not an error.
    getModelCatalogs()
      .then((c) => {
        if (active) setCatalogs(c);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!adapters || !values) return error ? <ErrorAlert>{error}</ErrorAlert> : <LoadingState />;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Each section saves on its own." />
      <div className="flex flex-col gap-6">
        <SettingsSection
          title="Agent"
          description="The agent CLI the app runs for discovery and mail sync."
          getPatch={() => ({
            adapter_id: values.adapter_id,
            custom_command: values.custom_command,
            ...Object.fromEntries(AGENT_CHOICE_KEYS.map((key) => [key, values[key]])),
          })}
        >
          <AdapterChooser
            adapters={adapters}
            adapterId={values.adapter_id}
            customCommand={values.custom_command}
            onAdapterChange={(adapter) => set('adapter_id', adapter)}
            onCustomCommandChange={(v) => set('custom_command', v)}
          />
          <AgentModelFields
            adapterId={values.adapter_id}
            values={values}
            catalogs={catalogs}
            onChange={(key, value) => set(key, value)}
          />
        </SettingsSection>
        <SettingsSection
          title="Permissions"
          description="What the agent is allowed to do in each kind of run."
          getPatch={() => Object.fromEntries(PERMISSION_FIELDS.map(([key]) => [key, values[key]]))}
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            {PERMISSION_FIELDS.map(([key, label]) => (
              <Field key={key}>
                <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
                <Input
                  id={`${id}-${key}`}
                  className="font-mono"
                  value={values[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        </SettingsSection>
        <SettingsSection
          title="Runs"
          getPatch={() => ({
            run_timeout_ms: values.run_timeout_ms,
            sync_interval: values.sync_interval,
            claude_max_budget_usd_discover: values.claude_max_budget_usd_discover,
          })}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor={`${id}-timeout`}>Run timeout (ms)</FieldLabel>
              <Input
                id={`${id}-timeout`}
                type="number"
                value={values.run_timeout_ms}
                onChange={(e) => set('run_timeout_ms', Number(e.target.value))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-interval`}>Sync interval</FieldLabel>
              <NativeSelect
                id={`${id}-interval`}
                value={values.sync_interval}
                onChange={(e) => set('sync_interval', e.target.value as Settings['sync_interval'])}
              >
                {['off', '1h', '6h', '24h'].map((v) => (
                  <NativeSelectOption key={v} value={v}>
                    {v}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className="col-span-2">
              <FieldLabel htmlFor={`${id}-budget`}>Claude spend cap per discovery agent (USD)</FieldLabel>
              <Input
                id={`${id}-budget`}
                className="max-w-xs font-mono"
                inputMode="decimal"
                placeholder="No cap"
                value={values.claude_max_budget_usd_discover}
                onChange={(e) => set('claude_max_budget_usd_discover', e.target.value.trim())}
              />
              <FieldDescription>
                Claude only. Stops a discovery agent once Claude Code&apos;s own cost estimate passes this amount; each
                Max-effort worker has its own cap. A stopped agent returns no jobs, so treat this as a safety net. Leave
                empty for no cap.
              </FieldDescription>
            </Field>
          </div>
        </SettingsSection>
        <SettingsSection title="Server" getPatch={() => ({ port: values.port })}>
          <Field className="max-w-xs">
            <FieldLabel htmlFor={`${id}-port`}>Port</FieldLabel>
            <Input
              id={`${id}-port`}
              type="number"
              value={values.port}
              onChange={(e) => set('port', Number(e.target.value))}
            />
            <FieldDescription>Port changes take effect on restart.</FieldDescription>
          </Field>
        </SettingsSection>
        <DataSection dataDir={dataDir} />
      </div>
    </div>
  );
}
