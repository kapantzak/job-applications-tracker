import { useState } from 'react';
import { CircleArrowUpIcon, XIcon } from 'lucide-react';
import type { UpdateStatus } from '../../server/domain/types.js';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { releaseUrl } from './HelpMenu.js';

// Holds the version the user closed the notice for, so a still newer one shows it again (SOW-0053).
export const UPDATE_DISMISSED_KEY = 'update-dismissed';

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(UPDATE_DISMISSED_KEY);
  } catch {
    return null;
  }
}

function storeDismissed(version: string) {
  try {
    window.localStorage.setItem(UPDATE_DISMISSED_KEY, version);
  } catch {
    // Without storage the notice stays closed for this page load only.
  }
}

export function UpdateBanner({ update }: { update: UpdateStatus | null }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!update?.available || !update.latest || dismissed === update.latest) return null;
  const latest = update.latest;

  return (
    // A notice, not an error: polite, so it is not read out over the page on every load.
    <Alert role="status" className="mb-6 pr-12">
      <CircleArrowUpIcon />
      <AlertTitle className="line-clamp-none">
        Version {latest} is available (you have {update.current})
      </AlertTitle>
      <AlertDescription>
        <p>
          Update with <code className="font-mono">npm i -g job-applications-tracker@latest</code> or run{' '}
          <code className="font-mono">npx job-applications-tracker@latest</code>, then restart the app.
        </p>
        <a
          className="font-medium text-foreground underline underline-offset-4"
          href={releaseUrl(latest)}
          target="_blank"
          rel="noopener noreferrer"
        >
          What&apos;s new in {latest}
        </a>
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 size-7"
        aria-label="Dismiss update notice"
        onClick={() => {
          storeDismissed(latest);
          setDismissed(latest);
        }}
      >
        <XIcon />
      </Button>
    </Alert>
  );
}
