import { useEffect, useId, useState, type ReactNode } from 'react';
import { CheckCheckIcon, CheckIcon, ExternalLinkIcon, XIcon } from 'lucide-react';
import {
  acceptAllApplicationProposals,
  acceptApplicationProposal,
  acceptProposal,
  listApplicationProposals,
  listProposals,
  rejectApplicationProposal,
  rejectProposal,
  type AcceptManyResult,
  type ProposalWithApplication,
} from '../api/client.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { formatDay, formatTime } from '../format.js';
import { STATUS_LABELS } from '../labels.js';
import { useProfileId } from '../profile-route.js';
import type { ApplicationProposal, ProposalEvidence } from '../../server/domain/types.js';
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const percent = (confidence: number) => `${Math.round(confidence * 100)}%`;

interface ProposalCardProps {
  title: string;
  description: string;
  reason: string;
  evidence: ProposalEvidence;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}

// One card for both kinds of proposal: what it is, why, the mail it came from, and the decision.
function ProposalCard({ title, description, reason, evidence, busy, onAccept, onReject }: ProposalCardProps) {
  const headingId = useId();
  return (
    <Card role="article" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle>
          <h3 id={headingId}>{title}</h3>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">{reason}</p>
        <blockquote className="rounded-md border-l-4 bg-muted/40 px-4 py-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">From</dt>
            <dd>{evidence.from}</dd>
            <dt className="text-muted-foreground">Date</dt>
            <dd>{formatTime(evidence.date)}</dd>
            <dt className="text-muted-foreground">Subject</dt>
            <dd className="font-medium">{evidence.subject}</dd>
          </dl>
          <p className="mt-2 text-muted-foreground">{evidence.snippet}</p>
        </blockquote>
      </CardContent>
      <CardFooter className="gap-2 border-t">
        <Button type="button" disabled={busy} onClick={onAccept}>
          <CheckIcon />
          Accept
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onReject}>
          <XIcon />
          Reject
        </Button>
        <Button asChild variant="link" className="ml-auto">
          <a
            href={`https://mail.google.com/mail/#all/${encodeURIComponent(evidence.message_id)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Gmail
            <ExternalLinkIcon />
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ReviewPage() {
  const profileId = useProfileId();
  const [proposals, setProposals] = useState<ProposalWithApplication[] | null>(null);
  const [newApps, setNewApps] = useState<ApplicationProposal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What an accept did when the application was tracked by then (decision 11C).
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listProposals(profileId), listApplicationProposals(profileId)])
      .then(([status, fresh]) => {
        if (!active) return;
        setProposals(status);
        setNewApps(fresh);
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  const decide = async <T,>(key: string, action: () => Promise<T>, done: (result: T) => void) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      done(await action());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const dropProposal = (id: string) => () => setProposals((prev) => prev?.filter((p) => p.id !== id) ?? null);
  // A saved application that moved on changes its status cards (decision 19A); a failed reload keeps the old ones.
  const reloadStatusChanges = () => {
    listProposals(profileId)
      .then(setProposals)
      .catch(() => {});
  };
  const dropNewApp = (id: string) => () => setNewApps((prev) => prev?.filter((p) => p.id !== id) ?? null);
  const acceptedNewApp =
    (id: string) =>
    ({ outcome, application }: Awaited<ReturnType<typeof acceptApplicationProposal>>) => {
      dropNewApp(id)();
      const name = `${application.company} - ${application.role}`;
      if (outcome === 'already_tracked') setNotice(`${name} is already in your applications; nothing was added.`);
      if (outcome === 'moved') {
        setNotice(`${name} was saved; it is now ${STATUS_LABELS[application.status]}.`);
        reloadStatusChanges();
      }
    };
  const acceptedAll = (shown: string[]) => (counts: AcceptManyResult) => {
    setNewApps((prev) => prev?.filter((p) => !shown.includes(p.id)) ?? null);
    const parts = [
      counts.created > 0 && `${counts.created} added`,
      counts.moved > 0 && `${counts.moved} saved ${counts.moved === 1 ? 'one' : 'ones'} moved on`,
      counts.already_tracked > 0 && `${counts.already_tracked} already tracked`,
    ].filter(Boolean);
    if (parts.length > 0) setNotice(`${parts.join(', ')}.`);
    if (counts.moved > 0) reloadStatusChanges();
  };

  if (!proposals || !newApps) return error ? <ErrorAlert>{error}</ErrorAlert> : <LoadingState />;

  const acceptAll = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={busy !== null}>
          <CheckCheckIcon />
          Accept all new applications
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Accept all new applications?</AlertDialogTitle>
          <AlertDialogDescription>
            {newApps.length} applications will be added with the details shown. You can edit each one afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const shown = newApps.map((p) => p.id);
              void decide('all', () => acceptAllApplicationProposals(profileId, shown), acceptedAll(shown));
            }}
          >
            Accept all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Review"
        description="Applications and status changes found in your mail. Nothing changes until you accept."
      />
      <div className="flex flex-col gap-8">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {proposals.length === 0 && newApps.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Nothing to review</EmptyTitle>
              <EmptyDescription>Sync from Gmail to find your applications and the replies to them.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {newApps.length > 0 && (
          <Section title="New applications" action={newApps.length > 1 ? acceptAll : undefined}>
            {newApps.map((p) => (
              <ProposalCard
                key={p.id}
                title={`${p.company} - ${p.role}`}
                description={`New application · ${STATUS_LABELS[p.status]} · applied ${formatDay(p.applied_at)} (${percent(p.confidence)})`}
                reason={p.reason}
                evidence={p.evidence}
                busy={busy === p.id || busy === 'all'}
                onAccept={() => decide(p.id, () => acceptApplicationProposal(profileId, p.id), acceptedNewApp(p.id))}
                onReject={() => decide(p.id, () => rejectApplicationProposal(profileId, p.id), dropNewApp(p.id))}
              />
            ))}
          </Section>
        )}
        {proposals.length > 0 && (
          <Section title="Status changes">
            {proposals.map((p) => (
              <ProposalCard
                key={p.id}
                title={p.application ? `${p.application.company} - ${p.application.role}` : 'Unknown application'}
                description={
                  `${p.application ? STATUS_LABELS[p.application.status] : 'Unknown'} → ` +
                  `${STATUS_LABELS[p.proposed_status]} (${percent(p.confidence)})`
                }
                reason={p.reason}
                evidence={p.evidence}
                busy={busy === p.id}
                onAccept={() => decide(p.id, () => acceptProposal(profileId, p.id), dropProposal(p.id))}
                onReject={() => decide(p.id, () => rejectProposal(profileId, p.id), dropProposal(p.id))}
              />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
