import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRuns } from '../api/client.js';
import type { Run } from '../../server/domain/types.js';
import { CancelRunButton } from '../components/CancelRunButton.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { formatTime } from '../format.js';
import { profilePath, useProfileId } from '../profile-route.js';
import { RUN_STATUS_TONES } from '../labels.js';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const isActive = (r: Run) => r.status === 'queued' || r.status === 'running';
// A cancelled agent is killed within about 6 s (SIGTERM grace plus close grace); poll a while longer.
const SETTLE_POLL_MS = 1000;
const SETTLE_POLLS = 30;

export function RunsPage() {
  const profileId = useProfileId();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The list does not stream; after a cancel request it is re-read until that run has ended.
  const refreshUntilEnded = async (id: string) => {
    setError(null);
    for (let i = 0; i < SETTLE_POLLS && mounted.current; i++) {
      try {
        const list = await listRuns(profileId);
        if (!mounted.current) return;
        setRuns(list);
        const run = list.find((r) => r.id === id);
        if (!run || !isActive(run)) return;
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e));
        return;
      }
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
    }
  };

  useEffect(() => {
    let active = true;
    listRuns(profileId)
      .then((list) => {
        if (active) setRuns(list);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  // A refused cancel means the row is stale (saving or already finished): show why and re-read once.
  const onCancelRefused = (message: string) => {
    setError(message);
    listRuns(profileId)
      .then((list) => {
        if (mounted.current) setRuns(list);
      })
      .catch(() => {});
  };

  if (!runs) return error ? <ErrorAlert>{error}</ErrorAlert> : <LoadingState />;

  return (
    <div>
      <PageHeader title="Runs" description="Discovery and mail sync runs, newest first." />
      {error && (
        <div className="mb-4">
          <ErrorAlert>{error}</ErrorAlert>
        </div>
      )}
      {runs.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No runs yet</EmptyTitle>
            <EmptyDescription>Find jobs or sync from Gmail to start one.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Finished</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <Link to={profilePath(profileId, `/runs/${r.id}`)} className="font-mono text-sm font-medium hover:underline">
                      {r.kind}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={RUN_STATUS_TONES[r.status]}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatTime(r.started_at)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatTime(r.finished_at)}</TableCell>
                  <TableCell className="max-w-96 truncate whitespace-nowrap" title={r.summary ?? r.error ?? undefined}>
                    {r.summary ?? r.error ?? '–'}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {isActive(r) && (
                      <CancelRunButton
                        profileId={profileId}
                        runId={r.id}
                        onCancelled={() => void refreshUntilEnded(r.id)}
                        onError={onCancelRefused}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
