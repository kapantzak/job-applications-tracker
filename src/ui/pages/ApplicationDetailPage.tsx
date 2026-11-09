import { useEffect, useId, useState, type FormEvent } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getApplication, patchApplication, type ApplicationDetail } from '../api/client.js';
import { useProfileHref, useProfileId } from '../profile-route.js';
import { ErrorAlert, LoadingState, SuccessMessage } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { TagInput } from '../components/TagInput.js';
import { formatTime } from '../format.js';
import { useListReturnHref } from '../hooks/use-table-view.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

export function ApplicationDetailPage() {
  const fieldId = useId();
  const profileId = useProfileId();
  const href = useProfileHref();
  const backHref = useListReturnHref(href('/applications'));
  const { id = '' } = useParams();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [appliedDate, setAppliedDate] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setApp(null);
    getApplication(profileId, id)
      .then((a) => {
        if (!active) return;
        setApp(a);
        setCompany(a.company);
        setRole(a.role);
        setUrl(a.url ?? '');
        setNotes(a.notes ?? '');
        setAppliedDate(toDateInput(a.applied_at));
        setDomains(a.sender_domains);
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [profileId, id]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await patchApplication(profileId, id, {
        company,
        role,
        url: url || null,
        notes: notes || null,
        sender_domains: domains,
        applied_at: appliedDate ? new Date(`${appliedDate}T00:00:00Z`).toISOString() : null,
      });
      setSaved(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (!app) return error ? <ErrorAlert>{error}</ErrorAlert> : <LoadingState />;

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
        <Link to={backHref}>
          <ArrowLeftIcon />
          Applications
        </Link>
      </Button>
      <PageHeader
        title={
          <>
            {app.company} - {app.role}
          </>
        }
        actions={<StatusBadge status={app.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <form onSubmit={onSubmit} className="flex flex-col gap-6">
            <CardHeader>
              <CardTitle>
                <h2>Details</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor={`${fieldId}-company`}>Company</FieldLabel>
                    <Input
                      id={`${fieldId}-company`}
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${fieldId}-role`}>Role</FieldLabel>
                    <Input id={`${fieldId}-role`} value={role} onChange={(e) => setRole(e.target.value)} required />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-url`}>URL</FieldLabel>
                  <Input id={`${fieldId}-url`} value={url} onChange={(e) => setUrl(e.target.value)} />
                </Field>
                <Field className="max-w-xs">
                  <FieldLabel htmlFor={`${fieldId}-applied`}>Applied date</FieldLabel>
                  <Input
                    id={`${fieldId}-applied`}
                    type="date"
                    value={appliedDate}
                    onChange={(e) => setAppliedDate(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-notes`}>Notes</FieldLabel>
                  <Textarea id={`${fieldId}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
                <TagInput label="Sender domains" value={domains} onChange={setDomains} placeholder="example.com" />
              </FieldGroup>
            </CardContent>
            <CardFooter className="flex flex-col items-start gap-3 border-t">
              {error && <ErrorAlert>{error}</ErrorAlert>}
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={busy}>
                  Save
                </Button>
                {saved && <SuccessMessage>Saved</SuccessMessage>}
              </div>
            </CardFooter>
          </form>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>
              <h2>Status history</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {app.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No status changes yet.</p>
            ) : (
              <ol className="relative flex flex-col gap-4 border-l pl-4">
                {app.history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border bg-background" />
                    <p className="font-medium">
                      {h.from_status ?? 'none'} → {h.to_status}
                    </p>
                    <p className="text-muted-foreground">
                      {h.source}, {formatTime(h.changed_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
