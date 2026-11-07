import { useEffect, useState } from 'react';
import {
  hasFailedWorkers,
  MAX_EFFORT_CONCURRENCY,
  MAX_EFFORT_SOURCES,
  type Run,
  type Settings,
} from '../../server/domain/types.js';
import { getSettings, listRuns } from '../api/client.js';
import { formatUsage } from '../format.js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const AGENT_NAMES: Record<Settings['adapter_id'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  custom: 'your custom agent',
};

const AGENT_PLANS: Record<Settings['adapter_id'], string> = {
  claude: 'your own Claude Code plan',
  codex: 'your own Codex plan',
  custom: "your custom agent's own account",
};

// The app never sees the agent's bill, so the warning states scope and risk instead of a made-up
// estimate, and quotes what the last Max run reported (user decision 6, SOW-0016).
function capLine(settings: Settings): string {
  const agent = AGENT_NAMES[settings.adapter_id];
  if (settings.adapter_id !== 'claude') {
    const name = agent.charAt(0).toUpperCase() + agent.slice(1);
    return `${name} has no spend cap here; only the time limit stops a search.`;
  }
  return settings.claude_max_budget_usd_discover
    ? `Each search stops when Claude Code's own cost estimate reaches $${settings.claude_max_budget_usd_discover}.`
    : 'No spend cap is set in Settings; only the time limit stops a search.';
}

// Only complete runs are quoted: a cancelled, failed or partial Max run records just what its finished
// workers reported, which would understate what a full search uses (SOW-0021).
function lastMaxLine(runs: Run[]): string {
  const last = runs.find(
    (r) =>
      r.kind === 'discover_jobs' &&
      r.effort_mode === 'max' &&
      r.status === 'succeeded' &&
      !hasFailedWorkers(r.summary) &&
      formatUsage(r) !== null,
  );
  return last
    ? `Your last complete Max-effort search reported ${formatUsage(last)}.`
    : 'No earlier complete Max-effort search to compare with.';
}

interface Details {
  settings: Settings;
  runs: Run[];
}

// Opened by the Find jobs split button when Max effort is selected; it loads fresh details each time.
export function MaxSearchDialog({
  profileId,
  open,
  onOpenChange,
  onStart,
}: {
  profileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setDetails(null);
    setLoadError(null);
    Promise.all([getSettings(), listRuns(profileId, 50)])
      .then(([settings, runs]) => active && setDetails({ settings, runs }))
      .catch((e: unknown) => active && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [open, profileId]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start a Max-effort search?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {details && (
                <>
                  <p>
                    Runs {MAX_EFFORT_SOURCES.length} searches by source ({MAX_EFFORT_SOURCES.join(', ')}), up to{' '}
                    {MAX_EFFORT_CONCURRENCY} at a time. Each can run for up to{' '}
                    {Math.round(details.settings.run_timeout_ms / 60_000)} minutes.
                  </p>
                  <p>
                    It runs on {AGENT_PLANS[details.settings.adapter_id]} and can use several times the tokens of a
                    normal search. It can use up your plan&apos;s limits.
                  </p>
                  <p>{capLine(details.settings)}</p>
                  <p>{lastMaxLine(details.runs)}</p>
                </>
              )}
              {!details && !loadError && <p>Loading…</p>}
              {loadError && <p className="text-destructive">Could not load the search details: {loadError}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {/* The details are informational, so a failed load does not block starting. */}
          <AlertDialogAction disabled={!details && !loadError} onClick={onStart}>
            Start Max-effort search
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
