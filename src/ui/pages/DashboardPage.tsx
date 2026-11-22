import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { CircleCheckIcon, CircleXIcon, InboxIcon, MailIcon, MessagesSquareIcon, TrendingUpIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { summarizeDashboard, type DashboardResponse, type HistoryRow } from '../../server/domain/dashboard.js';
import type { Application, ApplicationStatus, Run, RunKind, Settings } from '../../server/domain/types.js';
import {
  getSettings,
  getDashboard,
  listApplicationHistory,
  listApplications,
  listJobs,
  listRuns,
  startDiscovery,
  startSync,
} from '../api/client.js';
import { APPLICATION_COLUMNS, applicationViewKey, tileQuery } from '../application-view.js';
import { AttentionCard } from '../components/dashboard/AttentionCard.js';
import { JourneyCard } from '../components/dashboard/JourneyCard.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { FindJobsButton } from '../components/FindJobsButton.js';
import { InfoTip } from '../components/InfoTip.js';
import { PageHeader } from '../components/PageHeader.js';
import { SyncScopeNote } from '../components/SyncScopeNote.js';
import { NoMatches, TableToolbar } from '../components/TableView.js';
import { RUN_SUFFIXES, selectionSummary } from '../agent-choices.js';
import { formatTime } from '../format.js';
import { FIELD_HELP, SCREEN_INTROS } from '../help-text.js';
import { useStoredTableView } from '../hooks/use-table-view.js';
import { useProfileHref, useProfileId } from '../profile-route.js';
import { applyView } from '../table-view.js';
import { ONE_TIME_VIEW } from '../view-storage.js';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Stats {
  // The route's counts: only the pending ones are read, since the rest must follow the filters.
  dashboard: DashboardResponse | null;
  apps: Application[] | null;
  history: HistoryRow[] | null;
  jobs: number | null;
  runs: Run[] | null;
  settings: Settings | null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NO_APPS: Application[] = [];

function lastSuccess(runs: Run[] | null, kind: RunKind): string {
  if (!runs) return '–';
  const run = runs.find((r) => r.kind === kind && r.status === 'succeeded');
  return run ? formatTime(run.finished_at ?? run.created_at) : 'never';
}

interface StatCardProps {
  label: string;
  value: number | null;
  testId: string;
  // Null when the filters leave no list to open: the number is shown without a link.
  to: string | null;
  // A tile opens Applications as a one-time view, so its status is not saved (SOW-0054, decision 8B).
  oneTime?: boolean;
  icon: ReactNode;
}

function StatCard({ label, value, testId, to, oneTime, icon }: StatCardProps) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction className="text-muted-foreground">{icon}</CardAction>
        <CardTitle className="text-3xl">
          {to === null ? (
            <span data-testid={testId}>{value === null ? '–' : value}</span>
          ) : (
            <Link
              to={to}
              state={oneTime ? ONE_TIME_VIEW : undefined}
              className="hover:underline"
              data-testid={testId}
              aria-label={`${label}: ${value === null ? 'unavailable' : value}`}
            >
              {value === null ? '–' : value}
            </Link>
          )}
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

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getDashboard(profileId),
      listApplications(profileId),
      listApplicationHistory(profileId),
      listJobs(profileId),
      listRuns(profileId),
      getSettings(),
    ]).then(([dashboard, apps, history, jobs, runs, settings]) => {
      if (!active) return;
      const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
      setStats({
        dashboard: value(dashboard),
        apps: value(apps),
        history: value(history),
        jobs: value(jobs)?.length ?? null,
        runs: value(runs),
        settings: value(settings),
      });
      // One alert per message: the list and history routes usually fail together.
      const failed = [dashboard, apps, history, jobs, runs, settings].flatMap((r) =>
        r.status === 'rejected' ? [message(r.reason)] : [],
      );
      setErrors([...new Set(failed)]);
    });
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

  // The filter set the Applications page shares (SOW-0054); the tiles, Journey and quiet list follow it.
  const view = useStoredTableView(APPLICATION_COLUMNS, stats?.apps ?? NO_APPS, applicationViewKey(profileId));
  const loaded = !!stats?.apps && !!stats.history;
  const history = stats?.history ?? null;
  // The saved sort is for the Applications table (decision 9A): unsorted rows keep the quiet list's ties in
  // the server's newest-first order. Pending counts stay with the route; the summary's own count is unused.
  const kept = useMemo(() => applyView(view.rows, view.columns, { ...view.state, sort: null }), [view.rows, view.columns, view.state]);
  const summary = useMemo(
    () => (loaded && history ? summarizeDashboard(kept, history, 0, new Date()) : null),
    [loaded, history, kept],
  );

  if (!stats) return <LoadingState />;
  const { settings, dashboard, apps, jobs } = stats;
  const counts = summary?.status_counts;
  const inProgress = counts ? counts.applied + counts.screening + counts.interview : null;
  const pendingProposals = dashboard?.pending_proposals ?? null;
  const newApplications = dashboard?.pending_new_applications ?? null;
  const tileLink = (statuses: readonly ApplicationStatus[]) => {
    const query = tileQuery(view.state, statuses);
    return query === null ? null : href(`/applications?${query}`);
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={SCREEN_INTROS.dashboard}
        actions={
          <>
            <FindJobsButton
              profileId={profileId}
              disabled={busy}
              onStart={(...args) => void start(() => startDiscovery(profileId, ...args))}
              onImported={(run) => navigate(href(`/runs/${run.id}`))}
            />
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" disabled={busy} onClick={() => start(() => startSync(profileId))}>
                <MailIcon />
                Sync from Gmail
              </Button>
              <InfoTip topic="Sync from Gmail" text={FIELD_HELP.syncFromGmail} />
            </div>
            <SyncScopeNote />
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {errors.map((e) => (
          <ErrorAlert key={e}>{e}</ErrorAlert>
        ))}
        {loaded && apps!.length > 0 && <TableToolbar view={view} noun="applications" />}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="In progress"
            value={inProgress}
            testId="count-in-progress"
            to={tileLink(['applied', 'screening', 'interview'])}
            oneTime
            icon={<TrendingUpIcon className="size-4" />}
          />
          <StatCard
            label="Interviews"
            value={counts?.interview ?? null}
            testId="count-interviews"
            to={tileLink(['interview'])}
            oneTime
            icon={<MessagesSquareIcon className="size-4" />}
          />
          <StatCard
            label="Offers"
            value={counts?.offer ?? null}
            testId="count-offers"
            to={tileLink(['offer'])}
            oneTime
            icon={<CircleCheckIcon className="size-4" />}
          />
          <StatCard
            label="Rejected"
            value={counts?.rejected ?? null}
            testId="count-rejected"
            to={tileLink(['rejected'])}
            oneTime
            // Red icon only: the number keeps the text colour so all tiles read alike (SOW-0035).
            icon={<CircleXIcon className="size-4 text-destructive" />}
          />
          <StatCard
            label="To review"
            value={dashboard ? dashboard.pending_proposals + dashboard.pending_new_applications : null}
            testId="count-proposals"
            to={href('/review')}
            icon={<InboxIcon className="size-4" />}
          />
        </div>
        {summary &&
          (apps!.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No applications yet</EmptyTitle>
                <EmptyDescription>
                  {newApplications !== null && newApplications > 0 ? (
                    <>
                      Sync from Gmail found {newApplications}{' '}
                      {newApplications === 1 ? 'new application' : 'new applications'}. Accept them
                      on the{' '}
                      <Link to={href('/review')} className="underline underline-offset-4">
                        Review page
                      </Link>{' '}
                      and they will show up here.
                    </>
                  ) : (
                    <>
                      Save or mark jobs as applied on the{' '}
                      <Link to={href('/jobs')} className="underline underline-offset-4">
                        Jobs
                      </Link>{' '}
                      page, or sync from Gmail to find applications you already made, and they will show up here.
                    </>
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {/* Only Journey gives way: the proposal lines below ignore the filters (decision 10A). */}
              {summary.total === 0 ? (
                <NoMatches onClear={view.reset} />
              ) : (
                <JourneyCard funnel={summary.funnel} stoppedAt={summary.stopped_at} saved={summary.status_counts.saved} />
              )}
              <AttentionCard
                pendingProposals={pendingProposals}
                newApplications={newApplications}
                quiet={summary.quiet}
                href={href}
              />
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
              Last job search: {lastSuccess(stats.runs, 'discover_jobs')}
              {jobs !== null && ` · ${jobs} ${jobs === 1 ? 'job' : 'jobs'}`}
            </p>
            <p className="text-muted-foreground">Last Gmail sync: {lastSuccess(stats.runs, 'sync_mail')}</p>
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
