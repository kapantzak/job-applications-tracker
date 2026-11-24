import { useEffect, useId, useState, type FormEvent } from 'react';
import { keepCandidate } from '../../server/domain/merge.js';
import { cleanName } from '../../server/domain/new-application.js';
import type { Application } from '../../server/domain/types.js';
import { mergeApplications, type ApplicationDetail } from '../api/client.js';
import { formatDay } from '../format.js';
import { STATUS_LABELS } from '../labels.js';
import { ErrorAlert } from './feedback.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Company names as written, one per company ignoring case and blanks, in the order listed.
function companies(apps: Application[]): string[] {
  const seen = new Map<string, string>();
  for (const a of apps) {
    const name = cleanName(a.company);
    if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()];
}

// The user picks which application to keep; the others fold into it (SOW-0055, decisions 1A-5A).
export function MergeApplicationsDialog({
  profileId,
  applications,
  open,
  onOpenChange,
  onMerged,
}: {
  profileId: string;
  applications: Application[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: (kept: ApplicationDetail, removedIds: string[]) => void;
}) {
  const id = useId();
  // The list as it was when the dialog opened: the page clears its selection on success, and the dialog must
  // not change while it animates closed.
  const [list, setList] = useState(applications);
  const [keepId, setKeepId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each opening starts from the furthest-stage application, so the Dashboard keeps the stage reached.
  useEffect(() => {
    if (!open || applications.length === 0) return;
    setList(applications);
    setKeepId(keepCandidate(applications));
    setError(null);
    // Only on opening: the list does not change while the dialog is open.
  }, [open]);

  const names = companies(list);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const removed = list.filter((a) => a.id !== keepId).map((a) => a.id);
    setBusy(true);
    setError(null);
    try {
      const kept = await mergeApplications(profileId, keepId, removed);
      onMerged(kept, removed);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Merge {list.length} applications</DialogTitle>
            <DialogDescription>
              The others are removed. Their history and proposals move to the one you keep, and their names are kept
              so Gmail sync still matches their mail. Empty details are filled from them, sender domains are combined
              and notes are joined. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {names.length > 1 && (
            <Alert>
              <AlertDescription>These applications name different companies: {names.join(', ')}.</AlertDescription>
            </Alert>
          )}
          <RadioGroup aria-label="Application to keep" value={keepId} onValueChange={setKeepId} className="gap-3">
            {list.map((a) => {
              const name = `${a.company} - ${a.role}`;
              const details = a.applied_at ? `${STATUS_LABELS[a.status]} · applied ${formatDay(a.applied_at)}` : STATUS_LABELS[a.status];
              return (
                <div key={a.id} className="flex items-start gap-2">
                  <RadioGroupItem id={`${id}-${a.id}`} value={a.id} aria-label={`${name}, ${details}`} className="mt-0.5" />
                  <Label htmlFor={`${id}-${a.id}`} className="flex flex-col items-start gap-0.5 font-normal">
                    <span className="font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">{details}</span>
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !keepId}>
              Merge applications
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
