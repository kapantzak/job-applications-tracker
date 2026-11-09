import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { QuietApplication } from '../../../server/domain/dashboard.js';
import { STATUS_LABELS } from '../../labels.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const VISIBLE = 5;

interface AttentionCardProps {
  pendingProposals: number;
  quiet: QuietApplication[];
  href: (path: string) => string;
}

function quietLine(q: QuietApplication): string {
  return q.status === 'applied'
    ? `Applied ${q.days} days ago, no reply`
    : `${STATUS_LABELS[q.status]}, no change in ${q.days} days`;
}

export function AttentionCard({ pendingProposals, quiet, href }: AttentionCardProps) {
  const [expanded, setExpanded] = useState(false);
  // Expands in place: a link to a list page would show a different count than this card.
  const shown = expanded ? quiet : quiet.slice(0, VISIBLE);
  const hidden = quiet.length - shown.length;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          <h2>Needs attention</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {pendingProposals === 0 && quiet.length === 0 ? (
          <p className="text-muted-foreground">Nothing needs you right now.</p>
        ) : (
          <ul aria-label="Needs attention" className="flex flex-col divide-y">
            {pendingProposals > 0 && (
              <li className="py-2 first:pt-0">
                <Link to={href('/review')} className="font-medium hover:underline">
                  {pendingProposals} {pendingProposals === 1 ? 'status proposal' : 'status proposals'} waiting
                </Link>
              </li>
            )}
            {shown.map((q) => (
              <li key={q.id} className="flex flex-col gap-0.5 py-2 first:pt-0">
                <Link to={href(`/applications/${q.id}`)} className="font-medium wrap-anywhere hover:underline">
                  {q.company} · {q.role}
                </Link>
                <span className="text-muted-foreground">{quietLine(q)}</span>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <Button type="button" variant="link" className="h-auto self-start p-0" onClick={() => setExpanded(true)}>
            Show {hidden} more
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
