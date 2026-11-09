import { useId } from 'react';
import type { ModelCatalog, Settings } from '../../server/domain/types.js';
import type { ModelCatalogs } from '../api/client.js';
import { FIELD_HELP } from '../help-text.js';
import { ADAPTER_LABELS } from '../labels.js';
import { InfoTip, WithInfo } from './InfoTip.js';
import {
  effortWarning,
  FALLBACK_EFFORTS,
  isPresetAgent,
  RUN_SUFFIXES,
  type AgentChoiceKey,
} from '../agent-choices.js';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

interface AgentModelFieldsProps {
  adapterId: Settings['adapter_id'];
  values: Settings;
  // null while loading or when the catalogs could not be fetched; the fields still work as free text.
  catalogs: ModelCatalogs | null;
  onChange: (key: AgentChoiceKey, value: string) => void;
}

function effortLevels(catalog: ModelCatalog | undefined, model: string, current: string): string[] {
  const known = catalog?.models.find((m) => m.id === model)?.efforts;
  const levels = known ?? (catalog?.efforts.length ? catalog.efforts : FALLBACK_EFFORTS);
  // A stored level the list does not offer stays selectable instead of being silently dropped.
  return current && !levels.includes(current) ? [...levels, current] : levels;
}

// Only when the catalog knows the model: an unknown model may well accept the level.
function unsupportedEffort(catalog: ModelCatalog | undefined, model: string, effort: string): string | null {
  const known = catalog?.models.find((m) => m.id === model)?.efforts;
  if (!effort || !known || known.includes(effort)) return null;
  return `${model} does not list ${effort}; the run may fail.`;
}

export function AgentModelFields({ adapterId, values, catalogs, onChange }: AgentModelFieldsProps) {
  const prefix = useId();
  if (!isPresetAgent(adapterId)) {
    return (
      <p className="text-sm text-muted-foreground">
        Model and effort: set them in your custom command.
      </p>
    );
  }
  const catalog = catalogs?.[adapterId];
  const listId = `${prefix}-models`;

  return (
    // Named by the legend text alone, so the ⓘ button does not join the group's name.
    <FieldSet aria-labelledby={`${prefix}-legend`}>
      <FieldLegend variant="label" className="flex items-center gap-1">
        <span id={`${prefix}-legend`}>Model and effort</span>
        <InfoTip topic="Model and effort" text={FIELD_HELP.modelAndEffort} />
      </FieldLegend>
      <FieldDescription>
        Leave the model empty and the effort on Agent default to use what your {ADAPTER_LABELS[adapterId]} configuration
        sets.
        {catalog?.source === 'unavailable' &&
          ` Could not read the ${ADAPTER_LABELS[adapterId]} model list; type a model id.`}
      </FieldDescription>
      <datalist id={listId}>
        {catalog?.models.map((m) => (
          <option key={m.id} value={m.id} label={m.label} />
        ))}
      </datalist>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        {RUN_SUFFIXES.map(({ suffix, label }) => {
          const modelKey: AgentChoiceKey = `${adapterId}_model_${suffix}`;
          const effortKey: AgentChoiceKey = `${adapterId}_effort_${suffix}`;
          const effort = values[effortKey];
          const warnings = [unsupportedEffort(catalog, values[modelKey], effort), effortWarning(effort)].filter(
            (w): w is string => w !== null,
          );
          return [
            <Field key={modelKey}>
              <WithInfo topic={`Model (${label})`} text={FIELD_HELP.model}>
                <FieldLabel htmlFor={`${prefix}-${modelKey}`}>Model ({label})</FieldLabel>
              </WithInfo>
              <Input
                id={`${prefix}-${modelKey}`}
                className="font-mono"
                list={listId}
                placeholder="Agent default"
                value={values[modelKey]}
                onChange={(e) => onChange(modelKey, e.target.value.trim())}
              />
            </Field>,
            <Field key={effortKey}>
              <WithInfo topic={`Effort (${label})`} text={FIELD_HELP.effort}>
                <FieldLabel htmlFor={`${prefix}-${effortKey}`}>Effort ({label})</FieldLabel>
              </WithInfo>
              <NativeSelect
                id={`${prefix}-${effortKey}`}
                value={effort}
                onChange={(e) => onChange(effortKey, e.target.value)}
              >
                <NativeSelectOption value="">Agent default</NativeSelectOption>
                {effortLevels(catalog, values[modelKey], effort).map((level) => (
                  <NativeSelectOption key={level} value={level}>
                    {level}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {warnings.map((w) => (
                <FieldDescription key={w} className="text-warning-text">
                  {w}
                </FieldDescription>
              ))}
            </Field>,
          ];
        })}
      </div>
    </FieldSet>
  );
}
