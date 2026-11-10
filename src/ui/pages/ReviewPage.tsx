import { useEffect, useState } from 'react';
import { CheckIcon, ExternalLinkIcon, XIcon } from 'lucide-react';
import {
  acceptProposal,
  listProposals,
  rejectProposal,
  type ProposalWithApplication,
} from '../api/client.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { formatTime } from '../format.js';
import { STATUS_LABELS } from '../labels.js';
import { useProfileId } from '../profile-route.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ReviewPage() {
  const profileId = useProfileId();
  const [proposals, setProposals] = useState<ProposalWithApplication[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listProposals(profileId)
      .then((list) => {
        if (active) setProposals(list);
      })
      .catch((e: unknown) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  const decide = async (id: string, action: (profileId: string, id: string) => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await action(profileId, id);
      setProposals((prev) => prev?.filter((p) => p.id !== id) ?? null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  if (!proposals) return error ? <ErrorAlert>{error}</ErrorAlert> : <LoadingState />;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Review" description="Status changes proposed from your mail. Nothing changes until you accept." />
      <div className="flex flex-col gap-4">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        {proposals.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Nothing to review</EmptyTitle>
              <EmptyDescription>Sync from Gmail to look for replies to your applications.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {proposals.map((p) => (
          <Card key={p.id} role="article">
              <CardHeader>
                <CardTitle>
                  <h2>{p.application ? `${p.application.company} - ${p.application.role}` : 'Unknown application'}</h2>
                </CardTitle>
                <CardDescription>
                  {`${p.application ? STATUS_LABELS[p.application.status] : 'Unknown'} → ` +
                    `${STATUS_LABELS[p.proposed_status]} (${Math.round(p.confidence * 100)}%)`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm">{p.reason}</p>
                <blockquote className="rounded-md border-l-4 bg-muted/40 px-4 py-3 text-sm">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">From</dt>
                    <dd>{p.evidence.from}</dd>
                    <dt className="text-muted-foreground">Date</dt>
                    <dd>{formatTime(p.evidence.date)}</dd>
                    <dt className="text-muted-foreground">Subject</dt>
                    <dd className="font-medium">{p.evidence.subject}</dd>
                  </dl>
                  <p className="mt-2 text-muted-foreground">{p.evidence.snippet}</p>
                </blockquote>
              </CardContent>
              <CardFooter className="gap-2 border-t">
                <Button type="button" disabled={busy === p.id} onClick={() => decide(p.id, acceptProposal)}>
                  <CheckIcon />
                  Accept
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy === p.id}
                  onClick={() => decide(p.id, rejectProposal)}
                >
                  <XIcon />
                  Reject
                </Button>
                <Button asChild variant="link" className="ml-auto">
                  <a
                    href={`https://mail.google.com/mail/#all/${encodeURIComponent(p.evidence.message_id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Gmail
                    <ExternalLinkIcon />
                  </a>
                </Button>
              </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
