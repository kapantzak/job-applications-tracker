import { useEffect, useId, useState, type FormEvent } from 'react';
import { CopyIcon } from 'lucide-react';
import { CUSTOM_PROMPT_MAX, type Run } from '../../server/domain/types.js';
import { getImportPrompt, importJobs } from '../api/client.js';
import { FIELD_HELP } from '../help-text.js';
import { ErrorAlert, SuccessMessage } from './feedback.js';
import { WithInfo } from './InfoTip.js';
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';

type CopyState = { kind: 'idle' } | { kind: 'copied' } | { kind: 'manual'; prompt: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Opened from the Find jobs menu (user decision 5, SOW-0043): copy the app's search prompt into any agent
// client, then paste its answer back. What was typed stays while the page is open.
export function ImportJobsDialog({
  profileId,
  open,
  onOpenChange,
  onImported,
}: {
  profileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (run: Run) => void;
}) {
  const id = useId();
  const [instructions, setInstructions] = useState('');
  const [reply, setReply] = useState('');
  const [copy, setCopy] = useState<CopyState>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The instructions inside the last copied prompt: that is what the agent saw, whatever is typed later.
  const [copiedWith, setCopiedWith] = useState<{ text: string | undefined } | null>(null);
  const customPrompt = instructions.trim() || undefined;

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const changeInstructions = (text: string) => {
    setInstructions(text);
    // A copied or shown prompt no longer matches the new instructions.
    setCopy({ kind: 'idle' });
  };

  const copyPrompt = async () => {
    setError(null);
    setCopy({ kind: 'idle' });
    let prompt: string;
    try {
      prompt = (await getImportPrompt(profileId, customPrompt)).prompt;
    } catch (e) {
      setError(errorText(e));
      return;
    }
    try {
      if (!navigator.clipboard) throw new Error('No clipboard');
      await navigator.clipboard.writeText(prompt);
      setCopy({ kind: 'copied' });
    } catch {
      // Some browsers refuse clipboard access; the user can still copy the text by hand.
      setCopy({ kind: 'manual', prompt });
    }
    setCopiedWith({ text: customPrompt });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const run = await importJobs(profileId, reply, copiedWith ? copiedWith.text : customPrompt);
      onImported(run);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Import from another agent</DialogTitle>
            <DialogDescription>
              Run the app&apos;s search prompt in any agent, such as a chat app, then paste its answer here. The prompt
              includes this profile and the links of jobs you already have.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-5">
            <section aria-labelledby={`${id}-step1`} className="flex flex-col gap-3">
              <h3 id={`${id}-step1`} className="text-sm font-medium">
                1. Copy the prompt
              </h3>
              <Field>
                <WithInfo topic="Instructions" text={FIELD_HELP.importInstructions}>
                  <FieldLabel htmlFor={`${id}-instructions`}>Instructions (optional)</FieldLabel>
                </WithInfo>
                <Textarea
                  id={`${id}-instructions`}
                  value={instructions}
                  maxLength={CUSTOM_PROMPT_MAX}
                  rows={2}
                  placeholder="For example: only fintech companies."
                  onChange={(e) => changeInstructions(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => void copyPrompt()}>
                  <CopyIcon />
                  Copy prompt
                </Button>
                {copy.kind === 'copied' && <SuccessMessage>Prompt copied. Paste it into your agent.</SuccessMessage>}
              </div>
              {copy.kind === 'manual' && (
                <Field>
                  <FieldLabel htmlFor={`${id}-prompt`}>Copying is not available here. Select the prompt and copy it.</FieldLabel>
                  <Textarea
                    id={`${id}-prompt`}
                    readOnly
                    rows={6}
                    value={copy.prompt}
                    onFocus={(e) => e.target.select()}
                  />
                </Field>
              )}
            </section>
            <section aria-labelledby={`${id}-step2`} className="flex flex-col gap-3">
              <h3 id={`${id}-step2`} className="text-sm font-medium">
                2. Paste the answer
              </h3>
              <Field>
                <WithInfo topic="Agent answer" text={FIELD_HELP.importReply}>
                  <FieldLabel htmlFor={`${id}-reply`}>Agent answer</FieldLabel>
                </WithInfo>
                <Textarea
                  id={`${id}-reply`}
                  value={reply}
                  rows={6}
                  className="font-mono text-xs"
                  onChange={(e) => setReply(e.target.value)}
                />
              </Field>
            </section>
          </FieldGroup>
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !reply.trim()}>
              Import jobs
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
