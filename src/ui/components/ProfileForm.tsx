import { useId, useState, type FormEvent } from 'react';
import {
  isValidProfileName,
  normalizeProfileName,
  PROFILE_NAME_ERROR,
  PROFILE_NAME_HINT,
} from '../../server/domain/profile-name.js';
import type { Profile } from '../../server/domain/types.js';
import { ApiError, type ProfileInput } from '../api/client.js';
import { ErrorAlert, SuccessMessage } from './feedback.js';
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
};

export function toProfileInput(profile: Profile): ProfileInput {
  const { id: _id, slug: _slug, created_at: _createdAt, ...input } = profile;
  return input;
}

interface ProfileFormProps {
  initial: ProfileInput;
  submitLabel: string;
  onSubmit: (input: ProfileInput) => Promise<unknown>;
  // Shown after a successful submit; omit when the caller navigates away instead.
  successMessage?: string;
}

// Shared by the first-run screen, New profile and the profile's own edit page.
export function ProfileForm({ initial, submitLabel, onSubmit, successMessage }: ProfileFormProps) {
  const id = useId();
  const [form, setForm] = useState<ProfileInput>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) => setForm({ ...form, [key]: value });

  // Same rule as the server (SOW-0015). Checked as the user types; surrounding spaces are trimmed on save.
  const name = normalizeProfileName(form.name);
  const nameError = name !== '' && !isValidProfileName(name) ? PROFILE_NAME_ERROR : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setError(null);
    if (name === '') {
      setError('Give the profile a name');
      return;
    }
    // The message is already under the Name field.
    if (nameError) return;
    if (form.target_roles.length === 0) {
      setError('Add at least one target role');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ ...form, name });
      setForm((prev) => ({ ...prev, name }));
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
              <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
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
            <TagInput label="Target roles" value={form.target_roles} onChange={(v) => set('target_roles', v)} />
            <TagInput label="Locations" value={form.locations} onChange={(v) => set('locations', v)} />
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor={`${id}-remote`}>Remote</FieldLabel>
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
              <Field>
                <FieldLabel htmlFor={`${id}-seniority`}>Seniority</FieldLabel>
                <Input
                  id={`${id}-seniority`}
                  value={form.seniority}
                  onChange={(e) => set('seniority', e.target.value)}
                />
              </Field>
            </div>
            <TagInput label="Keywords" value={form.keywords} onChange={(v) => set('keywords', v)} />
            <TagInput
              label="Excluded companies"
              value={form.excluded_companies}
              onChange={(v) => set('excluded_companies', v)}
            />
            <Field>
              <FieldLabel htmlFor={`${id}-notes`}>Notes</FieldLabel>
              <Textarea id={`${id}-notes`} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
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
