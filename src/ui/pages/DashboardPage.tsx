import { useEffect, useId, useState, type ReactNode } from 'react';
import { BriefcaseIcon, FileTextIcon, InboxIcon, MailIcon, SearchIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { Run, RunKind, Settings } from '../../server/domain/types.js';
import {
  getSettings,
  listApplications,
  listJobs,
  listProposals,
  listRuns,
  startDiscovery,
  startSync,
} from '../api/client.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { RUN_SUFFIXES, selectionSummary } from '../agent-choices.js';
import { formatTime } from '../format.js';
import { profilePath, useProfileId } from '../profile-route.js';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Stats {
  applications: number | null;
  proposals: number | null;
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
        <CardTitle className="text-3xl tabular-nums">
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
  const navigate = useNavigate();
  const agentHeadingId = useId();
  const [stats, setStats] = useState<Stats | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      listApplications(profileId, true),
      listProposals(profileId),
      listJobs(profileId),
      listRuns(profileId),
      getSettings(),
    ]).then(
      ([apps, proposals, jobs, runs, settings]) => {
        if (!active) return;
        const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
        setStats({
          applications: value(apps)?.length ?? null,
          proposals: value(proposals)?.length ?? null,
          jobs: value(jobs)?.length ?? null,
          runs: value(runs),
          settings: value(settings),
        });
        setErrors(
          [apps, proposals, jobs, runs, settings].flatMap((r) => (r.status === 'rejected' ? [message(r.reason)] : [])),
        );
      },
    );
    return () => {
      active = false;
    };
  }, [profileId]);

  const start = async (action: typeof startDiscovery) => {
    setBusy(true);
    try {
      const run = await action(profileId);
      navigate(profilePath(profileId, `/runs/${run.id}`));
    } catch (e) {
      setErrors([message(e)]);
      setBusy(false);
    }
  };

  if (!stats) return <LoadingState />;
  const { settings } = stats;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <Button type="button" disabled={busy} onClick={() => start(startDiscovery)}>
              <SearchIcon />
              Find jobs
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => start(startSync)}>
              <MailIcon />
              Sync from Gmail
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {errors.map((e) => (
          <ErrorAlert key={e}>{e}</ErrorAlert>
        ))}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Open applications"
            value={stats.applications}
            testId="count-applications"
            to={profilePath(profileId, '/applications')}
            icon={<FileTextIcon className="size-4" />}
          />
          <StatCard
            label="Pending proposals"
            value={stats.proposals}
            testId="count-proposals"
            to={profilePath(profileId, '/review')}
            icon={<InboxIcon className="size-4" />}
          />
          <StatCard
            label="Jobs"
            value={stats.jobs}
            testId="count-jobs"
            to={profilePath(profileId, '/jobs')}
            icon={<BriefcaseIcon className="size-4" />}
          />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Last successful runs</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <p className="text-muted-foreground">Last discovery: {lastSuccess(stats.runs, 'discover_jobs')}</p>
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
