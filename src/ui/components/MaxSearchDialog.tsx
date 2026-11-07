import { useState } from 'react';
import { RocketIcon } from 'lucide-react';
import { MAX_EFFORT_CONCURRENCY, MAX_EFFORT_SOURCES, type Run, type Settings } from '../../server/domain/types.js';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

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

function lastMaxLine(runs: Run[]): string {
  const last = runs.find((r) => r.kind === 'discover_jobs' && r.effort_mode === 'max' && formatUsage(r) !== null);
  return last
    ? `Your last Max-effort search reported ${formatUsage(last)}. A search that times out or is cancelled reports nothing, so the real use can be higher.`
    : 'No earlier Max-effort search to compare with.';
}

interface Details {
  settings: Settings;
  runs: Run[];
}

export function MaxSearchDialog({
  profileId,
  onStart,
  disabled = false,
}: {
  profileId: string;
  onStart: () => void;
  disabled?: boolean;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = (open: boolean) => {
    if (!open) return;
    setDetails(null);
    setLoadError(null);
    Promise.all([getSettings(), listRuns(profileId, 50)])
      .then(([settings, runs]) => setDetails({ settings, runs }))
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <AlertDialog onOpenChange={load}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <RocketIcon />
          Max-effort search
        </Button>
      </AlertDialogTrigger>
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
          <AlertDialogAction disabled={!details} onClick={onStart}>
            Start Max-effort search
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
