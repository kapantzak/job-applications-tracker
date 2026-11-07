import { useCallback, useEffect, useId, useState } from 'react';
import { BookmarkIcon, CheckIcon, ExternalLinkIcon, SearchIcon, XIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  dismissJob,
  listJobs,
  markApplied,
  saveJob,
  startDiscovery,
} from '../api/client.js';
import type { ApplicationStatus, JobListItem } from '../../server/domain/types.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { VerificationBadge } from '../components/VerificationBadge.js';
import { useProfileHref, useProfileId } from '../profile-route.js';
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
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Job URLs come from an agent and are untrusted; never render javascript: and similar schemes.
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

export function JobsPage() {
  const id = useId();
  const profileId = useProfileId();
  const href = useProfileHref();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);
  const [includeDead, setIncludeDead] = useState(false);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    listJobs(profileId, { includeDead, includeDismissed })
      .then((list) => {
        if (active) setJobs(list);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [profileId, includeDead, includeDismissed, reloadTick]);

  const run = useCallback(async <T,>(action: () => Promise<T>, after?: (result: T) => void) => {
    setError(null);
    try {
      const result = await action();
      after?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // The list carries the persisted status; a click only patches the row it changed.
  const setStatus = (jobId: string, status: ApplicationStatus) =>
    setJobs((list) => list && list.map((j) => (j.id === jobId ? { ...j, application_status: status } : j)));

  const onFind = async () => {
    setError(null);
    try {
      const started = await startDiscovery(profileId);
      navigate(href(`/runs/${started.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Jobs"
        description="Openings found by discovery runs, with their links checked."
        actions={
          <Button type="button" onClick={onFind}>
            <SearchIcon />
            Find jobs
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-dead`}
              checked={includeDead}
              onCheckedChange={(v) => setIncludeDead(v === true)}
            />
            <Label htmlFor={`${id}-dead`}>Show dead links</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-dismissed`}
              checked={includeDismissed}
              onCheckedChange={(v) => setIncludeDismissed(v === true)}
            />
            <Label htmlFor={`${id}-dismissed`}>Show dismissed</Label>
          </div>
        </div>
        {!jobs ? (
          <LoadingState />
        ) : jobs.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No jobs yet</EmptyTitle>
              <EmptyDescription>Run a discovery to find openings that match your profile.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Company</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const href = job.canonical_url || job.url;
                  return (
                    <TableRow key={job.id}>
                      <TableCell className="pl-4 font-medium">{job.company}</TableCell>
                      <TableCell className="max-w-64 truncate">{job.title}</TableCell>
                      <TableCell className="text-muted-foreground">{job.location ?? '–'}</TableCell>
                      <TableCell className="text-muted-foreground">{job.source_site ?? '–'}</TableCell>
                      <TableCell>
                        <VerificationBadge status={job.verification_status} />
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {isHttpUrl(href) && (
                            <Button asChild variant="ghost" size="sm">
                              <a href={href} target="_blank" rel="noopener noreferrer">
                                <ExternalLinkIcon />
                                Open
                              </a>
                            </Button>
                          )}
                          {job.application_status && <StatusBadge status={job.application_status} />}
                          {!job.application_status && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => run(() => saveJob(profileId, job.id), (a) => setStatus(job.id, a.status))}
                            >
                              <BookmarkIcon />
                              Save
                            </Button>
                          )}
                          {(!job.application_status || job.application_status === 'saved') && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => run(() => markApplied(profileId, job.id), (a) => setStatus(job.id, a.status))}
                            >
                              <CheckIcon />
                              Mark applied
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
                                <XIcon />
                                Dismiss
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Dismiss this job?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {job.company}, {job.title} will be hidden from the list. Turn on Show dismissed to
                                  see it again.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => run(() => dismissJob(profileId, job.id), () => setReloadTick((t) => t + 1))}
                                >
                                  Dismiss job
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
