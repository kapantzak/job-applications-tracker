import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, getProfile, putProfile, type ProfileInput } from '../api/client.js';
import { ErrorAlert, LoadingState, SuccessMessage } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { TagInput } from '../components/TagInput.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

const EMPTY: ProfileInput = {
  target_roles: [],
  locations: [],
  remote: 'any',
  seniority: '',
  keywords: [],
  excluded_companies: [],
  notes: '',
};

export function ProfilePage() {
  const id = useId();
  const [form, setForm] = useState<ProfileInput | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getProfile()
      .then((profile) => {
        if (!active) return;
        if (!profile) return setForm(EMPTY);
        const { created_at: _createdAt, ...rest } = profile;
        setForm(rest);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        setForm(EMPTY);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!form) return <LoadingState />;

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) =>
    setForm({ ...form, [key]: value });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setError(null);
    if (form.target_roles.length === 0) {
      setError('Add at least one target role');
      return;
    }
    try {
      await putProfile(form);
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Profile" description="What you are looking for. Discovery runs use this to search." />
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <CardContent>
            <FieldGroup>
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
              <Button type="submit">Save</Button>
              {status && <SuccessMessage>{status}</SuccessMessage>}
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
