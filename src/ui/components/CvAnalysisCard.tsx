import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlertIcon, CircleCheckIcon, FileTextIcon, RotateCcwIcon, SparklesIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { CvAnalysis } from '../../server/domain/types.js';
import { ApiError, discardCvAnalysis, retryCvAnalysis } from '../api/client.js';
import { formatElapsed } from '../format.js';
import { CvIllustration } from './CvIllustration.js';
import { ErrorAlert } from './feedback.js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useElapsed(since: string, ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now - Date.parse(since);
}

interface ConfirmProps {
  trigger: ReactNode;
  title: string;
  description: string;
  keepLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
}

function Confirm({ trigger, title, description, keepLabel, confirmLabel, onConfirm }: ConfirmProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{keepLabel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface CvAnalysisCardProps {
  // A profile's own analysis suggests changes to it (SOW-0024); `profile_id` null becomes a new profile.
  analysis: CvAnalysis;
  // Called with the new state after Analyse again (the analysis) or Cancel and Discard (null).
  onChange: (analysis: CvAnalysis | null) => void;
  onReview: () => void;
  // Re-reads the analysis after a 404 or 409: it was changed elsewhere, for example in another tab.
  onStale: () => void;
}

const HEADLINES: Record<CvAnalysis['status'], string> = {
  running: 'Analysing your CV',
  succeeded: 'Your CV is analysed',
  failed: 'The CV analysis failed',
  interrupted: 'The CV analysis was interrupted',
};

// The one CV analysis, wherever a profile can be created (SOW-0023, decision 23).
export function CvAnalysisCard(props: CvAnalysisCardProps) {
  // Outside the card, which changes shape with the status, so the region stays mounted and screen
  // readers hear "Your CV is analysed" when the agent finishes.
  return (
    <>
      <p role="status" className="sr-only">
        {HEADLINES[props.analysis.status]}
      </p>
      <AnalysisCard {...props} />
    </>
  );
}

function AnalysisCard({ analysis, onChange, onReview, onStale }: CvAnalysisCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = analysis.status === 'running';
  const profileId = analysis.profile_id ?? undefined;
  const forProfile = profileId !== undefined;
  const elapsed = useElapsed(analysis.started_at, running);

  const act = async (action: () => Promise<CvAnalysis | null>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (e) {
      setError(message(e));
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) onStale();
    } finally {
      setBusy(false);
    }
  };
  const discard = () =>
    act(async () => {
      await discardCvAnalysis(profileId);
      return null;
    });

  const discardButton = (
    <Confirm
      trigger={
        <Button type="button" variant="ghost" disabled={busy}>
          <Trash2Icon />
          Discard
        </Button>
      }
      title="Discard the CV analysis?"
      description={
        forProfile
          ? 'The suggested changes and the uploaded CV are deleted. Your profile and its current CV stay as they are.'
          : 'The suggested profile and the uploaded CV are deleted. You can upload a CV again afterwards.'
      }
      keepLabel="Keep it"
      confirmLabel="Discard"
      onConfirm={discard}
    />
  );

  if (running) {
    return (
      <Card aria-busy="true" className="border-primary/40">
        <CardHeader className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:text-left">
          <CvIllustration scanning className="w-28 shrink-0" />
          <div className="space-y-1.5">
            <CardTitle>
              <h2>Analysing your CV</h2>
            </CardTitle>
            <CardDescription>
              {forProfile
                ? 'We are analysing your CV with AI. The suggested changes will be ready soon.'
                : 'We are analysing your CV with AI. Your profile will be ready soon.'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress aria-label="Analysing your CV" />
          <p className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <FileTextIcon className="size-4" />
              {analysis.file_name}
            </span>
            <span>{formatElapsed(elapsed)}</span>
          </p>
          <p className="text-xs text-muted-foreground">You can leave this page; the analysis keeps going.</p>
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-3">
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <Confirm
            trigger={
              <Button type="button" variant="outline" disabled={busy}>
                <XIcon />
                Cancel
              </Button>
            }
            title="Cancel the CV analysis?"
            description="The agent is stopped and the uploaded CV is deleted."
            keepLabel="Keep analysing"
            confirmLabel="Cancel analysis"
            onConfirm={discard}
          />
        </CardFooter>
      </Card>
    );
  }

  if (analysis.status === 'succeeded') {
    return (
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleCheckIcon className="size-5 text-success" />
            <h2>Your CV is analysed</h2>
          </CardTitle>
          <CardDescription>
            {forProfile
              ? `The changes suggested from ${analysis.file_name} are ready. Review them, then save the profile to keep them and the new CV.`
              : `The profile suggested from ${analysis.file_name} is ready. Review it before it is saved.`}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col items-start gap-3">
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onReview} disabled={busy}>
              <SparklesIcon />
              {forProfile ? 'Review changes' : 'Review and create'}
            </Button>
            {discardButton}
          </div>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleAlertIcon className="size-5 text-destructive" />
          <h2>{analysis.status === 'interrupted' ? 'The CV analysis was interrupted' : 'The CV analysis failed'}</h2>
        </CardTitle>
        <CardDescription>{analysis.error}</CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-col items-start gap-3">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => act(() => retryCvAnalysis(profileId))}>
            <RotateCcwIcon />
            Analyse again
          </Button>
          {discardButton}
        </div>
      </CardFooter>
    </Card>
  );
}
