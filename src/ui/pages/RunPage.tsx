import { useEffect, useId, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, LoaderCircleIcon } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getRun, getRunLog, subscribeRunEvents } from '../api/client.js';
import { RUN_SAVING_LOG_LINE, type Run } from '../../server/domain/types.js';
import { CancelRunButton } from '../components/CancelRunButton.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { LogView } from '../components/LogView.js';
import { PageHeader } from '../components/PageHeader.js';
import { runAgentLabel, runChoiceLabel } from '../agent-choices.js';
import { formatTime } from '../format.js';
import { profilePath, useProfileId } from '../profile-route.js';
import { RUN_STATUS_TONES } from '../labels.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const NO_GMAIL = 'Your agent has no Gmail tool';

export function RunPage() {
  const profileId = useProfileId();
  const { id = '' } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const rawId = useId();

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const fail = (e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : String(e));
    };
    setRun(null);
    setLines([]);
    setError(null);
    setSaving(false);

    const refresh = () =>
      getRun(profileId, id)
        .then((fresh) => {
          if (active) setRun(fresh);
        })
        .catch(fail);

    getRun(profileId, id)
      .then(async (initial) => {
        if (!active) return;
        setRun(initial);
        if (initial.status === 'queued' || initial.status === 'running') {
          let agentSeen = false;
          // Subscribed once per mount; the client closes the stream itself after `done`.
          unsubscribe = subscribeRunEvents(
            profileId,
            id,
            (line) => {
              if (!active) return;
              setLines((prev) => [...prev, line]);
              if (line === RUN_SAVING_LOG_LINE) setSaving(true);
              // Handlers record agent, model and effort right after logging this line.
              if (!agentSeen && line.startsWith('Using adapter ')) {
                agentSeen = true;
                void refresh();
              }
            },
            () => void refresh(),
          );
        } else {
          const text = await getRunLog(profileId, id);
          if (active) setLines(text === '' ? [] : text.split('\n'));
        }
      })
      .catch(fail);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [profileId, id]);

  if (!run) return error ? <ErrorAlert>{error}</ErrorAlert> : <LoadingState />;

  const terminal = run.status !== 'queued' && run.status !== 'running';
  const succeeded = run.status === 'succeeded';
  const followUp = (to: string, label: string) => (
    <Button asChild variant="outline" size="sm">
      <Link to={to}>
        {label}
        <ArrowRightIcon />
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link to={profilePath(profileId, '/runs')}>
            <ArrowLeftIcon />
            Runs
          </Link>
        </Button>
        <PageHeader
          title="Run"
          actions={
            <div className="flex items-start gap-3">
              {!terminal && (
                <CancelRunButton
                  profileId={profileId}
                  runId={run.id}
                  saving={saving}
                  // A queued run comes back already aborted; a running one ends through the event stream.
                  onCancelled={(fresh) => setRun(fresh)}
                />
              )}
              <Badge variant={RUN_STATUS_TONES[run.status]} className="text-sm">
                {!terminal && <LoaderCircleIcon className="animate-spin" />}
                {run.status}
              </Badge>
            </div>
          }
        />
        <Card className="py-4">
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Kind</dt>
                <dd className="font-mono">{run.kind}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{run.status}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Started</dt>
                <dd>{formatTime(run.started_at)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Finished</dt>
                <dd>{formatTime(run.finished_at)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Agent</dt>
                <dd className="font-mono">{runAgentLabel(run)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Model</dt>
                <dd>
                  {runChoiceLabel(run, 'agent_model')}
                  {run.agent_model_reported && (
                    <span className="block font-mono text-xs text-muted-foreground">
                      ran as {run.agent_model_reported}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Effort</dt>
                <dd>{runChoiceLabel(run, 'agent_effort')}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
      {succeeded && run.summary && (
        <Alert role="status">
          <AlertDescription className="text-foreground">{run.summary}</AlertDescription>
        </Alert>
      )}
      {!succeeded && terminal && run.error && <ErrorAlert>{run.error}</ErrorAlert>}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {terminal && (
        <div className="flex flex-wrap gap-2">
          {run.kind === 'discover_jobs' && followUp(profilePath(profileId, '/jobs'), 'View jobs')}
          {run.kind === 'sync_mail' && followUp(profilePath(profileId, '/review'), 'Review proposals')}
          {run.status === 'failed' && run.error?.startsWith(NO_GMAIL) && followUp('/settings', 'Open settings')}
        </div>
      )}
      <section aria-label="Log" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-muted-foreground">Log</h2>
          <div className="flex items-center gap-2">
            <Checkbox id={rawId} checked={showRaw} onCheckedChange={(v) => setShowRaw(v === true)} />
            <Label htmlFor={rawId} className="text-sm font-normal text-muted-foreground">
              Show raw output
            </Label>
          </div>
        </div>
        <LogView lines={lines} raw={showRaw} />
      </section>
    </div>
  );
}
