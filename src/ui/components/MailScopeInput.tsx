import { useId, useState } from 'react';
import type { MailFilterKind } from '../../server/domain/mail-filter.js';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const GMAIL_SEARCH_HELP = 'https://support.google.com/mail/answer/7190';

interface MailScopeInputProps {
  kind: MailFilterKind;
  value: string;
  error: string | null;
  onChange: (kind: MailFilterKind, value: string) => void;
}

// One mode at a time (SOW-0031, decision 5): only the selected mode is saved. The input shows `value`;
// the other mode's text is held here so switching back restores it.
export function MailScopeInput({ kind, value, error, onChange }: MailScopeInputProps) {
  const id = useId();
  const [otherText, setOtherText] = useState('');

  const switchTo = (next: MailFilterKind) => {
    if (next === kind) return;
    setOtherText(value);
    onChange(next, otherText);
  };

  const isLabel = kind === 'label';
  const inputId = `${id}-value`;
  const helpId = `${id}-help`;

  return (
    <FieldSet>
      <FieldLegend>Gmail sync</FieldLegend>
      <FieldDescription>
        Tell sync where this profile's replies are in Gmail. Leave it empty to search by company and job-board
        senders. The app never labels or moves mail: create the label and a Gmail filter that applies it yourself.
      </FieldDescription>
      <RadioGroup name={`${id}-kind`} value={kind} onValueChange={(v) => switchTo(v as MailFilterKind)}>
        {/* The radio sits inside its label so the whole card is the click target and its accessible name. */}
        <FieldLabel htmlFor={`${id}-label`}>
          <Field orientation="horizontal">
            <RadioGroupItem id={`${id}-label`} value="label" />
            <FieldContent>
              <FieldTitle>Gmail label</FieldTitle>
              <FieldDescription>The name of a label as Gmail shows it, for example Jobs/Frontend.</FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>
        <FieldLabel htmlFor={`${id}-query`}>
          <Field orientation="horizontal">
            <RadioGroupItem id={`${id}-query`} value="query" />
            <FieldContent>
              <FieldTitle>Custom Gmail search (advanced)</FieldTitle>
              <FieldDescription>
                Any Gmail search, for example label:jobs-frontend OR to:you+frontend@gmail.com.
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>
      </RadioGroup>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={inputId}>{isLabel ? 'Label name' : 'Gmail search'}</FieldLabel>
        <Input
          id={inputId}
          value={value}
          placeholder={isLabel ? 'Jobs/Frontend' : 'label:jobs-frontend OR to:you+frontend@gmail.com'}
          aria-invalid={error ? true : undefined}
          aria-describedby={helpId}
          onChange={(e) => onChange(kind, e.target.value)}
        />
        {error ? (
          <FieldError id={helpId}>{error}</FieldError>
        ) : (
          <FieldDescription id={helpId}>
            {isLabel ? (
              'Sync reads only mail with this label, from any sender.'
            ) : (
              <>
                Sync reads only mail that matches this search, from any sender. It uses{' '}
                <a
                  className="font-medium text-foreground underline underline-offset-4"
                  href={GMAIL_SEARCH_HELP}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Gmail search operators
                </a>
                .
              </>
            )}
          </FieldDescription>
        )}
      </Field>
    </FieldSet>
  );
}
