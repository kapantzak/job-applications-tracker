import { useCallback, useEffect, useId, useState } from 'react';
import { BookmarkIcon, CheckIcon, ExternalLinkIcon, XIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  dismissJob,
  listJobs,
  markApplied,
  saveJob,
  startDiscovery,
} from '../api/client.js';
import {
  APPLICATION_STATUSES,
  VERIFICATION_STATUSES,
  type ApplicationStatus,
  type EffortMode,
  type FitChecks,
  type FitVerdict,
  type JobListItem,
} from '../../server/domain/types.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { FindJobsButton } from '../components/FindJobsButton.js';
import { InfoTip } from '../components/InfoTip.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { NoMatches, SortableHead, TableToolbar } from '../components/TableView.js';
import { VERIFICATION_LABELS, VerificationBadge } from '../components/VerificationBadge.js';
import { formatTime } from '../format.js';
import { FIELD_HELP } from '../help-text.js';
import { useTableView } from '../hooks/use-table-view.js';
import { STATUS_LABELS } from '../labels.js';
import { useProfileHref, useProfileId } from '../profile-route.js';
import { type ColumnDef, orderIndex } from '../table-view.js';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Job URLs come from an agent and are untrusted; never render javascript: and similar schemes.
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

const FIT_FIELDS: Array<[keyof FitChecks, string]> = [
  ['location', 'Location'],
  ['remote', 'Remote'],
  ['seniority', 'Seniority'],
];
const FIT_LOOK: Record<FitVerdict, { symbol: string; words: string; tone: 'success' | 'destructive' | 'outline' }> = {
  pass: { symbol: '✓', words: 'matches', tone: 'success' },
  fail: { symbol: '✗', words: 'does not match', tone: 'destructive' },
  unknown: { symbol: '?', words: 'not stated', tone: 'outline' },
};

// The agent's verdict per must-have (SOW-0016); shown, never used to hide a job. Older jobs have none.
function FitBadges({ checks }: { checks: FitChecks | null }) {
  if (!checks) return <span className="text-muted-foreground">–</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {FIT_FIELDS.map(([field, label]) => {
        const look = FIT_LOOK[checks[field]] ?? FIT_LOOK.unknown;
        const name = `${label}: ${look.words}`;
        return (
          <Badge key={field} variant={look.tone} aria-label={name} title={name}>
            {label} {look.symbol}
          </Badge>
        );
      })}
    </div>
  );
}

// One verdict for the whole row, for the Fit filter: any mismatch wins, then anything not stated.
type FitSummary = 'pass' | 'unknown' | 'fail' | 'none';
const FIT_SUMMARY_ORDER: readonly FitSummary[] = ['pass', 'unknown', 'fail', 'none'];
const FIT_SUMMARY_LABELS: Record<FitSummary, string> = {
  pass: 'All match',
  unknown: 'Some not stated',
  fail: 'Has a mismatch',
  none: 'No verdict',
};
function fitSummary(checks: FitChecks | null): FitSummary {
  if (!checks) return 'none';
  const verdicts = FIT_FIELDS.map(([field]) => checks[field]);
  if (verdicts.includes('fail')) return 'fail';
  return verdicts.every((v) => v === 'pass') ? 'pass' : 'unknown';
}
const fitPasses = (checks: FitChecks | null) =>
  checks ? FIT_FIELDS.filter(([field]) => checks[field] === 'pass').length : null;
// "Not tracked" is a real choice in the Application filter, so it is not the empty option.
const NOT_TRACKED = 'none';
const APPLICATION_ORDER = [...APPLICATION_STATUSES, NOT_TRACKED];

const COLUMNS: ColumnDef<JobListItem>[] = [
  {
    id: 'company',
    label: 'Company',
    sortValue: (j) => j.company,
    searchText: (j) => j.company,
    filter: { kind: 'values', value: (j) => j.company },
  },
  {
    id: 'title',
    label: 'Title',
    sortValue: (j) => j.title,
    searchText: (j) => j.title,
    filter: { kind: 'text', value: (j) => j.title },
  },
  {
    id: 'location',
    label: 'Location',
    sortValue: (j) => j.location,
    searchText: (j) => j.location,
    filter: { kind: 'values', value: (j) => j.location, emptyLabel: 'No location' },
  },
  {
    id: 'source',
    label: 'Source',
    sortValue: (j) => j.source_site,
    searchText: (j) => j.source_site,
    filter: { kind: 'values', value: (j) => j.source_site, emptyLabel: 'No source' },
  },
  {
    id: 'fit',
    label: 'Fit',
    sortValue: (j) => fitPasses(j.fit_checks),
    filter: {
      kind: 'values',
      value: (j) => fitSummary(j.fit_checks),
      order: FIT_SUMMARY_ORDER,
      optionLabel: (v) => FIT_SUMMARY_LABELS[v as FitSummary] ?? v,
    },
  },
  {
    id: 'status',
    label: 'Status',
    sortValue: (j) => orderIndex(VERIFICATION_STATUSES, j.verification_status),
    filter: {
      kind: 'values',
      value: (j) => j.verification_status,
      order: VERIFICATION_STATUSES,
      optionLabel: (v) => VERIFICATION_LABELS[v as keyof typeof VERIFICATION_LABELS] ?? v,
    },
  },
  {
    id: 'found',
    label: 'Found',
    sortValue: (j) => j.created_at,
    filter: { kind: 'date', value: (j) => j.created_at },
  },
  // Shown as a badge in the Actions column, so it filters but has no header to sort by.
  {
    id: 'application',
    label: 'Application',
    filter: {
      kind: 'values',
      value: (j) => j.application_status ?? NOT_TRACKED,
      order: APPLICATION_ORDER,
      optionLabel: (v) => (v === NOT_TRACKED ? 'Not tracked' : (STATUS_LABELS[v as ApplicationStatus] ?? v)),
    },
  },
];
const NO_JOBS: JobListItem[] = [];

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
  const view = useTableView(COLUMNS, jobs ?? NO_JOBS);

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

  const onFind = async (mode: EffortMode) => {
    setError(null);
    try {
      const started = await startDiscovery(profileId, mode);
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
        actions={<FindJobsButton profileId={profileId} onStart={(mode) => void onFind(mode)} />}
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
            <InfoTip topic="Show dead links" text={FIELD_HELP.showDeadLinks} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-dismissed`}
              checked={includeDismissed}
              onCheckedChange={(v) => setIncludeDismissed(v === true)}
            />
            <Label htmlFor={`${id}-dismissed`}>Show dismissed</Label>
            <InfoTip topic="Show dismissed" text={FIELD_HELP.showDismissed} />
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
          <>
            <TableToolbar view={view} noun="jobs" />
            {view.visible.length === 0 ? (
              <NoMatches onClear={view.reset} />
            ) : (
              <Card className="py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead view={view} id="company" className="pl-4">
                        Company
                      </SortableHead>
                      <SortableHead view={view} id="title">
                        Title
                      </SortableHead>
                      <SortableHead view={view} id="location">
                        Location
                      </SortableHead>
                      <SortableHead view={view} id="source">
                        Source
                      </SortableHead>
                      <SortableHead view={view} id="fit">
                        Fit
                      </SortableHead>
                      <SortableHead view={view} id="status">
                        Status
                      </SortableHead>
                      <SortableHead view={view} id="found">
                        Found
                      </SortableHead>
                      <TableHead className="pr-4 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.visible.map((job) => {
                      const href = job.canonical_url || job.url;
                      return (
                        <TableRow key={job.id}>
                          <TableCell className="pl-4 font-medium">{job.company}</TableCell>
                          <TableCell className="max-w-64 truncate">{job.title}</TableCell>
                          <TableCell className="text-muted-foreground">{job.location ?? '–'}</TableCell>
                          <TableCell className="text-muted-foreground">{job.source_site ?? '–'}</TableCell>
                          <TableCell>
                            <FitBadges checks={job.fit_checks} />
                          </TableCell>
                          <TableCell>
                            <VerificationBadge status={job.verification_status} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatTime(job.created_at)}</TableCell>
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
          </>
        )}
      </div>
    </div>
  );
}
