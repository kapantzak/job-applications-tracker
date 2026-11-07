import { useId, useState } from 'react';
import { CircleCheckIcon } from 'lucide-react';
import type { CvAnalysis } from '../../server/domain/types.js';
import type { ProfileInput } from '../api/client.js';
import {
  applyChoices,
  reviewRows,
  type ReviewChoice,
  type ReviewField,
  type ReviewMode,
  type ReviewRow,
} from '../cv-review.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';

const FIELD_LABELS: Record<ReviewField, string> = {
  target_roles: 'Target roles',
  locations: 'Locations',
  remote: 'Remote',
  seniority: 'Seniority',
  keywords: 'Keywords',
};

const REMOTE_LABELS: Record<string, string> = { any: 'Any', remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };

const CHOICE_LABELS: Record<ReviewChoice, string> = {
  keep: 'Keep current',
  use: 'Use suggested',
  add: 'Add the new items',
};

function Value({ row, side }: { row: ReviewRow; side: 'current' | 'suggested' }) {
  if (row.kind === 'list') {
    const items = row[side];
    if (items.length === 0) return <span className="text-muted-foreground">None</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={item} variant="secondary" className="font-normal">
            {item}
          </Badge>
        ))}
      </span>
    );
  }
  const text = row.field === 'remote' ? REMOTE_LABELS[row[side]] : row[side];
  return text ? <span>{text}</span> : <span className="text-muted-foreground">None</span>;
}

function ReviewRowField({
  row,
  choice,
  onChoice,
}: {
  row: ReviewRow;
  choice: ReviewChoice;
  onChoice: (c: ReviewChoice) => void;
}) {
  const id = useId();
  const label = FIELD_LABELS[row.field];
  return (
    <section aria-labelledby={`${id}-label`} className="space-y-3 rounded-lg border p-3">
      <h3 id={`${id}-label`} className="text-sm font-medium">
        {label}
      </h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Current</dt>
          <dd>
            <Value row={row} side="current" />
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Suggested</dt>
          <dd>
            <Value row={row} side="suggested" />
          </dd>
        </div>
      </dl>
      <RadioGroup
        aria-label={label}
        value={choice}
        onValueChange={(v) => onChoice(v as ReviewChoice)}
        className="flex flex-wrap gap-x-4 gap-y-2"
      >
        {row.choices.map((c) => (
          <div key={c} className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-${c}`} value={c} />
            <Label htmlFor={`${id}-${c}`} className="font-normal">
              {CHOICE_LABELS[c]}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </section>
  );
}

interface ReviewBodyProps {
  analysis: CvAnalysis & { draft: NonNullable<CvAnalysis['draft']> };
  mode: ReviewMode;
  form: ProfileInput;
  onApply: (next: ProfileInput) => void;
  onCancel: () => void;
}

// Mounted only while the panel is open, so the rows and choices start fresh from the form each time.
function ReviewBody({ analysis, mode, form, onApply, onCancel }: ReviewBodyProps) {
  const [rows] = useState(() => reviewRows(form, analysis.draft, mode));
  const [choices, setChoices] = useState<Partial<Record<ReviewField, ReviewChoice>>>({});
  const intro =
    mode === 'replace'
      ? `Suggested from ${analysis.file_name}. Only the fields that differ from your profile are listed.`
      : `Suggested from ${analysis.file_name}. Only the fields your profile leaves empty are listed.`;

  return (
    <>
      <SheetHeader className="pr-10">
        <SheetTitle>Review the suggested changes</SheetTitle>
        <SheetDescription>{intro} Name, excluded companies and notes are never changed.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-3 px-4">
        {rows.length === 0 ? (
          <p className="flex items-center gap-2 text-sm">
            <CircleCheckIcon className="size-4 text-success" />
            {mode === 'replace'
              ? 'Your profile already matches this CV.'
              : 'This CV has nothing to add: every field it covers already has a value.'}
          </p>
        ) : (
          rows.map((row) => (
            <ReviewRowField
              key={row.field}
              row={row}
              choice={choices[row.field] ?? row.initial}
              onChoice={(c) => setChoices((prev) => ({ ...prev, [row.field]: c }))}
            />
          ))
        )}
      </div>
      <SheetFooter>
        <p className="text-xs text-muted-foreground">
          Apply puts your choices into the form. Nothing is saved, and your current CV is kept, until you save the
          profile.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => onApply(applyChoices(form, rows, choices))}>
            Apply
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </SheetFooter>
    </>
  );
}

interface CvReviewSheetProps {
  // The analysis under review, or null when the panel is closed.
  analysis: CvAnalysis | null;
  mode: ReviewMode;
  // The form's values when the panel opened, saved or not (decision 33).
  form: ProfileInput | null;
  onApply: (next: ProfileInput) => void;
  onClose: () => void;
}

// The review of a profile's CV analysis (SOW-0024, decisions 16 and 33): a side panel over the form.
export function CvReviewSheet({ analysis, mode, form, onApply, onClose }: CvReviewSheetProps) {
  const open = analysis !== null && analysis.draft !== null && form !== null;
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {open && (
          <ReviewBody
            analysis={{ ...analysis, draft: analysis.draft! }}
            mode={mode}
            form={form}
            onApply={onApply}
            onCancel={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
