import { useState } from 'react';
import { CircleStopIcon } from 'lucide-react';
import type { Run } from '../../server/domain/types.js';
import { cancelRun } from '../api/client.js';
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
import { ErrorAlert } from './feedback.js';

interface CancelRunButtonProps {
  profileId: string;
  runId: string;
  // The run is saving its results; the server refuses cancellation from then on.
  saving?: boolean;
  onCancelled: (run: Run) => void;
  // When set, the parent shows the error; otherwise it renders under the button.
  onError?: (message: string) => void;
}

// Shared by the Run page and the Runs list; confirms first because a cancel discards the agent's work.
export function CancelRunButton({ profileId, runId, saving = false, onCancelled, onError }: CancelRunButtonProps) {
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const run = await cancelRun(profileId, runId);
      setRequested(true);
      onCancelled(run);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (onError) onError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };

  let control;
  if (saving) {
    control = (
      <Button type="button" variant="outline" size="sm" disabled>
        Saving results…
      </Button>
    );
  } else if (requested) {
    control = (
      <Button type="button" variant="outline" size="sm" disabled>
        Cancelling…
      </Button>
    );
  } else {
    control = (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={busy}>
            <CircleStopIcon />
            Cancel run
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
            <AlertDialogDescription>The agent is stopped and nothing from this run is saved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirm}>
              Cancel run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {control}
      {error && <ErrorAlert>{error}</ErrorAlert>}
    </div>
  );
}
