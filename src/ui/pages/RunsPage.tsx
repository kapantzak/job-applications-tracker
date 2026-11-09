import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRuns } from '../api/client.js';
import { RUN_STATUSES, type Run } from '../../server/domain/types.js';
import { CancelRunButton } from '../components/CancelRunButton.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { NoMatches, SortableHead, TableToolbar } from '../components/TableView.js';
import { formatTime } from '../format.js';
import { useListLinkState, useTableView } from '../hooks/use-table-view.js';
import { useProfileHref, useProfileId } from '../profile-route.js';
import { RUN_STATUS_TONES } from '../labels.js';
import { type ColumnDef, orderIndex } from '../table-view.js';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const isActive = (r: Run) => r.status === 'queued' || r.status === 'running';
// A cancelled agent is killed within about 6 s (SIGTERM grace plus close grace); poll a while longer.
const SETTLE_POLL_MS = 1000;
const SETTLE_POLLS = 30;
// The API's largest page; sorting and filters only see the runs loaded here (SOW-0029).
const RUNS_LIMIT = 200;

const result = (r: Run) => r.summary ?? r.error;
const COLUMNS: ColumnDef<Run>[] = [
  {
    id: 'kind',
    label: 'Kind',
    sortValue: (r) => r.kind,
    searchText: (r) => r.kind,
    filter: { kind: 'values', value: (r) => r.kind },
  },
  {
    id: 'status',
    label: 'Status',
    sortValue: (r) => orderIndex(RUN_STATUSES, r.status),
    filter: { kind: 'values', value: (r) => r.status, order: RUN_STATUSES },
  },
  { id: 'started', label: 'Started', sortValue: (r) => r.started_at, filter: { kind: 'date', value: (r) => r.started_at } },
  {
    id: 'finished',
    label: 'Finished',
    sortValue: (r) => r.finished_at,
    filter: { kind: 'date', value: (r) => r.finished_at },
  },
  {
    id: 'result',
    label: 'Result',
    sortValue: result,
    searchText: result,
    filter: { kind: 'text', value: result },
  },
];
const NO_RUNS: Run[] = [];

export function RunsPage() {
  const profileId = useProfileId();
  const href = useProfileHref();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const view = useTableView(COLUMNS, runs ?? NO_RUNS);
  const linkState = useListLinkState();

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
        const list = await listRuns(profileId, RUNS_LIMIT);
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
    listRuns(profileId, RUNS_LIMIT)
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
    listRuns(profileId, RUNS_LIMIT)
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
        <div className="flex flex-col gap-4">
          <TableToolbar
            view={view}
            noun="runs"
            note={runs.length >= RUNS_LIMIT ? `Only the newest ${RUNS_LIMIT} runs are loaded` : undefined}
          />
          {view.visible.length === 0 ? (
            <NoMatches onClear={view.reset} />
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead view={view} id="kind" className="pl-4">
                      Kind
                    </SortableHead>
                    <SortableHead view={view} id="status">
                      Status
                    </SortableHead>
                    <SortableHead view={view} id="started">
                      Started
                    </SortableHead>
                    <SortableHead view={view} id="finished">
                      Finished
                    </SortableHead>
                    <SortableHead view={view} id="result">
                      Result
                    </SortableHead>
                    <TableHead className="pr-4">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.visible.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4">
                        <Link to={href(`/runs/${r.id}`)} state={linkState} className="font-mono text-sm font-medium hover:underline">
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
      )}
    </div>
  );
}
