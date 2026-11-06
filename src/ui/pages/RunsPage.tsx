import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRuns } from '../api/client.js';
import type { Run } from '../../server/domain/types.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { formatTime } from '../format.js';
import { RUN_STATUS_TONES } from '../labels.js';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function RunsPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listRuns()
      .then((list) => {
        if (active) setRuns(list);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  if (!runs) return error ? <ErrorAlert>{error}</ErrorAlert> : <LoadingState />;

  return (
    <div>
      <PageHeader title="Runs" description="Discovery and mail sync runs, newest first." />
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
                <TableHead className="pr-4">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <Link to={`/runs/${r.id}`} className="font-mono text-sm font-medium hover:underline">
                      {r.kind}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={RUN_STATUS_TONES[r.status]}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatTime(r.started_at)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatTime(r.finished_at)}</TableCell>
                  <TableCell className="max-w-96 truncate pr-4 whitespace-nowrap" title={r.summary ?? r.error ?? undefined}>
                    {r.summary ?? r.error ?? '–'}
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
