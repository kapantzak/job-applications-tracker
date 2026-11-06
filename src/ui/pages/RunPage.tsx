import { useEffect, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, LoaderCircleIcon } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getRun, getRunLog, subscribeRunEvents } from '../api/client.js';
import type { Run } from '../../server/domain/types.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { LogView } from '../components/LogView.js';
import { PageHeader } from '../components/PageHeader.js';
import { formatTime } from '../format.js';
import { RUN_STATUS_TONES } from '../labels.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const NO_GMAIL = 'Your agent has no Gmail tool';

export function RunPage() {
  const { id = '' } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const fail = (e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : String(e));
    };
    setRun(null);
    setLines([]);
    setError(null);

    getRun(id)
      .then(async (initial) => {
        if (!active) return;
        setRun(initial);
        if (initial.status === 'queued' || initial.status === 'running') {
          // Subscribed once per mount; the client closes the stream itself after `done`.
          unsubscribe = subscribeRunEvents(
            id,
            (line) => {
              if (active) setLines((prev) => [...prev, line]);
            },
            () => {
              getRun(id)
                .then((fresh) => {
                  if (active) setRun(fresh);
                })
                .catch(fail);
            },
          );
        } else {
          const text = await getRunLog(id);
          if (active) setLines(text === '' ? [] : text.split('\n'));
        }
      })
      .catch(fail);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [id]);

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
          <Link to="/runs">
            <ArrowLeftIcon />
            Runs
          </Link>
        </Button>
        <PageHeader
          title="Run"
          actions={
            <Badge variant={RUN_STATUS_TONES[run.status]} className="text-sm">
              {!terminal && <LoaderCircleIcon className="animate-spin" />}
              {run.status}
            </Badge>
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
          {run.kind === 'discover_jobs' && followUp('/jobs', 'View jobs')}
          {run.kind === 'sync_mail' && followUp('/review', 'Review proposals')}
          {run.status === 'failed' && run.error?.startsWith(NO_GMAIL) && followUp('/settings', 'Open settings')}
        </div>
      )}
      <section aria-label="Log" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Log</h2>
        <LogView lines={lines} />
      </section>
    </div>
  );
}
