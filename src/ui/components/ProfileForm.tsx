import { useId, useImperativeHandle, useState, type FormEvent, type Ref } from 'react';
import {
  isValidProfileName,
  normalizeProfileName,
  PROFILE_NAME_ERROR,
  PROFILE_NAME_HINT,
} from '../../server/domain/profile-name.js';
import { mailFilterError, normalizeMailFilter } from '../../server/domain/mail-filter.js';
import type { Profile } from '../../server/domain/types.js';
import { ApiError, type ProfileInput } from '../api/client.js';
import { FIELD_HELP } from '../help-text.js';
import { ErrorAlert, SuccessMessage } from './feedback.js';
import { WithInfo } from './InfoTip.js';
import { MailScopeInput } from './MailScopeInput.js';
import { SeniorityInput } from './SeniorityInput.js';
import { TagInput } from './TagInput.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

export const EMPTY_PROFILE: ProfileInput = {
  name: '',
  target_roles: [],
  locations: [],
  remote: 'any',
  seniority: '',
  keywords: [],
  excluded_companies: [],
  notes: '',
  mail_filter_kind: 'label',
  mail_filter: '',
};

export function toProfileInput(profile: Profile): ProfileInput {
  const { id: _id, slug: _slug, created_at: _createdAt, cv: _cv, ...input } = profile;
  return input;
}

// Lets the Profile page's CV review read the form as it is, saved or not, and write the chosen
// suggestions back without the form losing its other edits (SOW-0024, decision 33).
export interface ProfileFormHandle {
  values(): ProfileInput;
  apply(next: ProfileInput): void;
}

interface ProfileFormProps {
  ref?: Ref<ProfileFormHandle>;
  initial: ProfileInput;
  submitLabel: string;
  onSubmit: (input: ProfileInput) => Promise<unknown>;
  // Shown after a successful submit; omit when the caller navigates away instead.
  successMessage?: string;
}

// Shared by the first-run screen, New profile (by hand or from a CV analysis) and the profile's own edit page.
export function ProfileForm({ ref, initial, submitLabel, onSubmit, successMessage }: ProfileFormProps) {
  const id = useId();
  const [form, setForm] = useState<ProfileInput>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // SeniorityInput keeps its chips and Other text from its first value; a new key after apply() starts it
  // from the applied value.
  const [applied, setApplied] = useState(0);
  useImperativeHandle(
    ref,
    () => ({
      values: () => form,
      apply: (next) => {
        setStatus(null);
        setForm(next);
        setApplied((n) => n + 1);
      },
    }),
    [form],
  );

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Same rule as the server (SOW-0015). Checked as the user types; surrounding spaces are trimmed on save.
  const name = normalizeProfileName(form.name);
  const nameError = name !== '' && !isValidProfileName(name) ? PROFILE_NAME_ERROR : null;
  // Same rule as the server (SOW-0031); shown under the field as the user types.
  const mailFilter = normalizeMailFilter(form.mail_filter);
  const mailFilterProblem = mailFilterError(form.mail_filter_kind, mailFilter);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setError(null);
    if (name === '') {
      setError('Give the profile a name');
      return;
    }
    // The messages are already under their fields.
    if (nameError || mailFilterProblem) return;
    if (form.target_roles.length === 0) {
      setError('Add at least one target role');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ ...form, name, mail_filter: mailFilter });
      setForm((prev) => ({ ...prev, name, mail_filter: mailFilter }));
      if (successMessage) setStatus(successMessage);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <CardContent>
          <FieldGroup>
            <Field data-invalid={nameError ? true : undefined}>
              <WithInfo topic="Name" text={FIELD_HELP.profileName}>
                <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
              </WithInfo>
              <Input
                id={`${id}-name`}
                value={form.name}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={`${id}-name-help`}
                onChange={(e) => set('name', e.target.value)}
              />
              {nameError ? (
                <FieldError id={`${id}-name-help`}>{nameError}</FieldError>
              ) : (
                <FieldDescription id={`${id}-name-help`}>{PROFILE_NAME_HINT}</FieldDescription>
              )}
            </Field>
            <TagInput
              label="Target roles"
              help={FIELD_HELP.targetRoles}
              value={form.target_roles}
              onChange={(v) => set('target_roles', v)}
            />
            <TagInput
              label="Locations"
              help={FIELD_HELP.locations}
              value={form.locations}
              onChange={(v) => set('locations', v)}
            />
            <Field className="sm:max-w-xs">
              <WithInfo topic="Remote" text={FIELD_HELP.remote}>
                <FieldLabel htmlFor={`${id}-remote`}>Remote</FieldLabel>
              </WithInfo>
              <NativeSelect
                id={`${id}-remote`}
                value={form.remote}
                onChange={(e) => set('remote', e.target.value as ProfileInput['remote'])}
              >
                <NativeSelectOption value="any">Any</NativeSelectOption>
                <NativeSelectOption value="remote">Remote</NativeSelectOption>
                <NativeSelectOption value="hybrid">Hybrid</NativeSelectOption>
                <NativeSelectOption value="onsite">On-site</NativeSelectOption>
              </NativeSelect>
            </Field>
            <SeniorityInput key={applied} value={form.seniority} onChange={(v) => set('seniority', v)} />
            <TagInput
              label="Keywords"
              help={FIELD_HELP.keywords}
              value={form.keywords}
              onChange={(v) => set('keywords', v)}
            />
            <TagInput
              label="Excluded companies"
              help={FIELD_HELP.excludedCompanies}
              value={form.excluded_companies}
              onChange={(v) => set('excluded_companies', v)}
            />
            <Field>
              <WithInfo topic="Notes" text={FIELD_HELP.profileNotes}>
                <FieldLabel htmlFor={`${id}-notes`}>Notes</FieldLabel>
              </WithInfo>
              <Textarea id={`${id}-notes`} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            <MailScopeInput
              kind={form.mail_filter_kind}
              value={form.mail_filter}
              error={mailFilterProblem}
              onChange={(kind, value) => setForm((prev) => ({ ...prev, mail_filter_kind: kind, mail_filter: value }))}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-3 border-t">
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
            {status && <SuccessMessage>{status}</SuccessMessage>}
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
