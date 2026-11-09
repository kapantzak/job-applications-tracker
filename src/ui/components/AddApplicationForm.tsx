import { useId, useState, type FormEvent } from 'react';
import type { Application, ApplicationStatus } from '../../server/domain/types.js';
import { createApplication } from '../api/client.js';
import { dayToIso } from '../format.js';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FIELD_HELP } from '../help-text.js';
import { ErrorAlert } from './feedback.js';
import { WithInfo } from './InfoTip.js';
import { StatusSelect } from './StatusSelect.js';

export function AddApplicationForm({
  profileId,
  onCreated,
}: {
  profileId: string;
  onCreated: (app: Application) => void;
}) {
  const id = useId();
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<ApplicationStatus>('applied');
  const [appliedDate, setAppliedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createApplication(profileId, {
        company,
        role,
        url: url || null,
        status,
        // A typed day is stored as local midnight (SOW-0030). Without a date the key is omitted so the
        // server's default (applied means now) applies.
        ...(appliedDate ? { applied_at: dayToIso(appliedDate) } : {}),
        notes,
      });
      onCreated(created);
      setCompany('');
      setRole('');
      setUrl('');
      setAppliedDate('');
      setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup className="gap-5">
        <Field>
          <WithInfo topic="Company" text={FIELD_HELP.company}>
            <FieldLabel htmlFor={`${id}-company`}>Company</FieldLabel>
          </WithInfo>
          <Input id={`${id}-company`} value={company} onChange={(e) => setCompany(e.target.value)} required />
        </Field>
        <Field>
          <WithInfo topic="Role" text={FIELD_HELP.role}>
            <FieldLabel htmlFor={`${id}-role`}>Role</FieldLabel>
          </WithInfo>
          <Input id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value)} required />
        </Field>
        <Field>
          <WithInfo topic="URL" text={FIELD_HELP.url}>
            <FieldLabel htmlFor={`${id}-url`}>URL</FieldLabel>
          </WithInfo>
          <Input
            id={`${id}-url`}
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <WithInfo topic="Status" text={FIELD_HELP.status}>
              <FieldLabel htmlFor={`${id}-status`}>Status</FieldLabel>
            </WithInfo>
            <StatusSelect id={`${id}-status`} value={status} onChange={setStatus} />
          </Field>
          <Field>
            <WithInfo topic="Applied date" text={FIELD_HELP.appliedDate}>
              <FieldLabel htmlFor={`${id}-applied`}>Applied date</FieldLabel>
            </WithInfo>
            <Input
              id={`${id}-applied`}
              type="date"
              value={appliedDate}
              onChange={(e) => setAppliedDate(e.target.value)}
            />
          </Field>
        </div>
        <Field>
          <WithInfo topic="Notes" text={FIELD_HELP.applicationNotes}>
            <FieldLabel htmlFor={`${id}-notes`}>Notes</FieldLabel>
          </WithInfo>
          <Textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </FieldGroup>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <Button type="submit" disabled={busy} className="self-start">
        Add
      </Button>
    </form>
  );
}
