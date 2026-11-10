import { useId, type FormEvent } from 'react';
import { CUSTOM_PROMPT_MAX, type EffortMode } from '../../server/domain/types.js';
import { FIELD_HELP } from '../help-text.js';
import { EFFORT_MODE_OPTIONS } from '../labels.js';
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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

// Opened from the Find jobs menu (user decision 5, SOW-0042). The text and mode live in the caller, so a
// search that is cancelled or refused can be started again without retyping.
export function CustomSearchDialog({
  open,
  onOpenChange,
  text,
  onTextChange,
  mode,
  onModeChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  onTextChange: (text: string) => void;
  mode: EffortMode;
  onModeChange: (mode: EffortMode) => void;
  onSubmit: (mode: EffortMode, text: string) => void;
}) {
  const id = useId();
  const trimmed = text.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (trimmed) onSubmit(mode, trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Custom search</DialogTitle>
            <DialogDescription>
              Tell your agent what this one search should look for. Your profile still applies.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-5">
            <Field>
              <WithInfo topic="Instructions" text={FIELD_HELP.customInstructions}>
                <FieldLabel htmlFor={`${id}-text`}>Instructions</FieldLabel>
              </WithInfo>
              <Textarea
                id={`${id}-text`}
                value={text}
                maxLength={CUSTOM_PROMPT_MAX}
                rows={5}
                placeholder="For example: only fintech companies, and skip agencies."
                aria-describedby={`${id}-count`}
                onChange={(e) => onTextChange(e.target.value)}
              />
              <p id={`${id}-count`} className="text-right text-xs text-muted-foreground">
                {text.length} / {CUSTOM_PROMPT_MAX}
              </p>
            </Field>
            <RadioGroup
              aria-label="Search mode"
              value={mode}
              onValueChange={(v) => onModeChange(v as EffortMode)}
              className="gap-3"
            >
              {EFFORT_MODE_OPTIONS.map((m) => (
                <div key={m.value} className="flex items-start gap-2">
                  <RadioGroupItem id={`${id}-${m.value}`} value={m.value} aria-label={m.title} className="mt-0.5" />
                  <Label htmlFor={`${id}-${m.value}`} className="flex flex-col items-start gap-0.5 font-normal">
                    <span className="font-medium">{m.title}</span>
                    <span className="text-xs text-muted-foreground">{m.description}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!trimmed}>
              Start search
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
