import { useId, useState } from 'react';
import { CheckIcon } from 'lucide-react';
import { joinSeniority, SENIORITY_LEVELS, splitSeniority, type SeniorityLevel } from '../../server/domain/seniority.js';
import { FIELD_HELP } from '../help-text.js';
import { InfoTip } from './InfoTip.js';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

interface SeniorityInputProps {
  value: string;
  onChange: (next: string) => void;
}

// Toggle chips plus free text (SOW-0023, decisions 27-29); the value stays one text field.
export function SeniorityInput({ value, onChange }: SeniorityInputProps) {
  const id = useId();
  // Other text is kept as typed: re-splitting it on every keystroke would turn "Lead" into a chip mid-word.
  const [selection, setSelection] = useState(() => splitSeniority(value));

  const update = (next: { levels: SeniorityLevel[]; other: string }) => {
    setSelection(next);
    onChange(joinSeniority(next));
  };

  const toggle = (level: SeniorityLevel) => {
    const on = selection.levels.includes(level);
    update({ ...selection, levels: on ? selection.levels.filter((l) => l !== level) : [...selection.levels, level] });
  };

  return (
    // Named by the legend text alone, so the ⓘ button does not join the group's name.
    <FieldSet className="gap-3" aria-labelledby={`${id}-legend`}>
      <FieldLegend variant="label" className="flex items-center gap-1">
        <span id={`${id}-legend`}>Seniority</span>
        <InfoTip topic="Seniority" text={FIELD_HELP.seniority} />
      </FieldLegend>
      <div className="flex flex-wrap gap-1.5">
        {SENIORITY_LEVELS.map((level) => {
          const on = selection.levels.includes(level);
          return (
            <Button
              key={level}
              type="button"
              size="sm"
              variant={on ? 'default' : 'outline'}
              aria-pressed={on}
              className="rounded-full"
              onClick={() => toggle(level)}
            >
              {on && <CheckIcon />}
              {level}
            </Button>
          );
        })}
      </div>
      <Field>
        <FieldLabel htmlFor={`${id}-other`} className="font-normal text-muted-foreground">
          Other
        </FieldLabel>
        <Input
          id={`${id}-other`}
          value={selection.other}
          placeholder="For example IC4 or tech lead"
          onChange={(e) => update({ ...selection, other: e.target.value })}
        />
        <FieldDescription>Pick one or more levels, or describe it in your own words.</FieldDescription>
      </Field>
    </FieldSet>
  );
}
