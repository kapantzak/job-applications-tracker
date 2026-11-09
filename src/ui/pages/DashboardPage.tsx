import { useEffect, useId, useState, type ReactNode } from 'react';
import { CircleCheckIcon, CircleXIcon, InboxIcon, MailIcon, MessagesSquareIcon, TrendingUpIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { DashboardSummary } from '../../server/domain/dashboard.js';
import type { Run, RunKind, Settings } from '../../server/domain/types.js';
import {
  getSettings,
  getDashboard,
  listJobs,
  listRuns,
  startDiscovery,
  startSync,
} from '../api/client.js';
import { AttentionCard } from '../components/dashboard/AttentionCard.js';
import { FunnelCard } from '../components/dashboard/FunnelCard.js';
import { JourneyCard } from '../components/dashboard/JourneyCard.js';
import { StatusBarCard } from '../components/dashboard/StatusBarCard.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { FindJobsButton } from '../components/FindJobsButton.js';
import { PageHeader } from '../components/PageHeader.js';
import { SyncScopeNote } from '../components/SyncScopeNote.js';
import { RUN_SUFFIXES, selectionSummary } from '../agent-choices.js';
import { chooseView, readStoredView, storeView, useJourneyFits, type DashboardView } from '../dashboard-view.js';
import { formatTime } from '../format.js';
import { useProfileHref, useProfileId } from '../profile-route.js';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Stats {
  summary: DashboardSummary | null;
  jobs: number | null;
  runs: Run[] | null;
  settings: Settings | null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function lastSuccess(runs: Run[] | null, kind: RunKind): string {
  if (!runs) return '–';
  const run = runs.find((r) => r.kind === kind && r.status === 'succeeded');
  return run ? formatTime(run.finished_at ?? run.created_at) : 'never';
}

interface StatCardProps {
  label: string;
  value: number | null;
  testId: string;
  to: string;
  icon: ReactNode;
}

function StatCard({ label, value, testId, to, icon }: StatCardProps) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction className="text-muted-foreground">{icon}</CardAction>
        <CardTitle className="text-3xl">
          <Link
            to={to}
            className="hover:underline"
            data-testid={testId}
            aria-label={`${label}: ${value === null ? 'unavailable' : value}`}
          >
            {value === null ? '–' : value}
          </Link>
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

export function DashboardPage() {
  const profileId = useProfileId();
  const href = useProfileHref();
  const navigate = useNavigate();
  const agentHeadingId = useId();
  const [stats, setStats] = useState<Stats | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const narrow = !useJourneyFits();
  const [storedView, setStoredView] = useState<DashboardView | null>(readStoredView);

  // Only an explicit choice is stored, so the automatic rule keeps applying until the user picks.
  const pickView = (next: DashboardView) => {
    storeView(next);
    setStoredView(next);
  };

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getDashboard(profileId),
      listJobs(profileId),
      listRuns(profileId),
      getSettings(),
    ]).then(
      ([summary, jobs, runs, settings]) => {
        if (!active) return;
        const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
        setStats({
          summary: value(summary),
          jobs: value(jobs)?.length ?? null,
          runs: value(runs),
          settings: value(settings),
        });
        setErrors(
          [summary, jobs, runs, settings].flatMap((r) => (r.status === 'rejected' ? [message(r.reason)] : [])),
        );
      },
    );
    return () => {
      active = false;
    };
  }, [profileId]);

  const start = async (action: () => Promise<Run>) => {
    setBusy(true);
    try {
      const run = await action();
      navigate(href(`/runs/${run.id}`));
    } catch (e) {
      setErrors([message(e)]);
      setBusy(false);
    }
  };

  if (!stats) return <LoadingState />;
  const { settings, summary, jobs } = stats;
  const counts = summary?.status_counts;
  const inProgress = counts ? counts.applied + counts.screening + counts.interview : null;
  const listLink = (query: string) => href(`/applications?${query}`);
  const view = summary ? chooseView(storedView, summary.funnel.applied, narrow) : 'breakdown';
  const attention = summary && (
    <AttentionCard pendingProposals={summary.pending_proposals} quiet={summary.quiet} href={href} />
  );

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <FindJobsButton
              profileId={profileId}
              disabled={busy}
              onStart={(mode) => void start(() => startDiscovery(profileId, mode))}
            />
            <Button type="button" variant="outline" disabled={busy} onClick={() => start(() => startSync(profileId))}>
              <MailIcon />
              Sync from Gmail
            </Button>
            <SyncScopeNote />
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {errors.map((e) => (
          <ErrorAlert key={e}>{e}</ErrorAlert>
        ))}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="In progress"
            value={inProgress}
            testId="count-in-progress"
            to={listLink('status=applied&status=screening&status=interview')}
            icon={<TrendingUpIcon className="size-4" />}
          />
          <StatCard
            label="Interviews"
            value={counts?.interview ?? null}
            testId="count-interviews"
            to={listLink('status=interview')}
            icon={<MessagesSquareIcon className="size-4" />}
          />
          <StatCard
            label="Offers"
            value={counts?.offer ?? null}
            testId="count-offers"
            to={listLink('status=offer')}
            icon={<CircleCheckIcon className="size-4" />}
          />
          <StatCard
            label="Rejected"
            value={counts?.rejected ?? null}
            testId="count-rejected"
            to={listLink('status=rejected')}
            // Red icon only: the number keeps the text colour so all tiles read alike (SOW-0035).
            icon={<CircleXIcon className="size-4 text-destructive" />}
          />
          <StatCard
            label="To review"
            value={summary?.pending_proposals ?? null}
            testId="count-proposals"
            to={href('/review')}
            icon={<InboxIcon className="size-4" />}
          />
        </div>
        {summary &&
          (summary.total === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No applications yet</EmptyTitle>
                <EmptyDescription>
                  Save or mark jobs as applied on the{' '}
                  <Link to={href('/jobs')} className="underline underline-offset-4">
                    Jobs
                  </Link>{' '}
                  page and they will show up here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {/* The graph needs the width, so windows under 1280 px get Breakdown only (SOW-0037 Decision 7). */}
              {!narrow && (
                <div className="-mb-2 flex justify-end">
                  <ButtonGroup aria-label="Dashboard view">
                    {(['journey', 'breakdown'] as const).map((option) => (
                      <Button
                        key={option}
                        type="button"
                        size="sm"
                        variant={view === option ? 'default' : 'outline'}
                        aria-pressed={view === option}
                        onClick={() => pickView(option)}
                      >
                        {option === 'journey' ? 'Journey' : 'Breakdown'}
                      </Button>
                    ))}
                  </ButtonGroup>
                </div>
              )}
              {view === 'journey' ? (
                <>
                  <JourneyCard
                    funnel={summary.funnel}
                    stoppedAt={summary.stopped_at}
                    saved={summary.status_counts.saved}
                  />
                  {attention}
                </>
              ) : (
                <>
                  <StatusBarCard total={summary.total} counts={summary.status_counts} href={href} />
                  <div className="grid gap-4 sm:grid-cols-5">
                    <div className="min-w-0 sm:col-span-3">
                      <FunnelCard funnel={summary.funnel} rejectedAt={summary.rejected_at} />
                    </div>
                    <div className="min-w-0 sm:col-span-2">{attention}</div>
                  </div>
                </>
              )}
            </>
          ))}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Last successful runs</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <p className="text-muted-foreground">
              Last discovery: {lastSuccess(stats.runs, 'discover_jobs')}
              {jobs !== null && ` · ${jobs} ${jobs === 1 ? 'job' : 'jobs'}`}
            </p>
            <p className="text-muted-foreground">Last sync: {lastSuccess(stats.runs, 'sync_mail')}</p>
          </CardContent>
        </Card>
        {settings && (
          <Card role="region" aria-labelledby={agentHeadingId}>
            <CardHeader>
              <CardTitle id={agentHeadingId}>
                <h2>Agent</h2>
              </CardTitle>
              <CardDescription>
                <Link to="/settings" className="underline underline-offset-4">
                  Change in Settings
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {RUN_SUFFIXES.map(({ suffix, title }) => (
                <p key={suffix} className="text-muted-foreground">
                  {title}: {selectionSummary(settings, suffix)}
                </p>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
