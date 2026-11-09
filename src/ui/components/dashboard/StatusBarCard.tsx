import { Link } from 'react-router-dom';
import { APPLICATION_STATUSES, type ApplicationStatus } from '../../../server/domain/types.js';
import { STATUS_LABELS } from '../../labels.js';
import { STATUS_COLOR_CLASS } from './status-colors.js';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface StatusBarCardProps {
  total: number;
  counts: Record<ApplicationStatus, number>;
  href: (path: string) => string;
}

export function StatusBarCard({ total, counts, href }: StatusBarCardProps) {
  const present = APPLICATION_STATUSES.filter((s) => counts[s] > 0);
  const label = present.map((s) => `${STATUS_LABELS[s]}: ${counts[s]}`).join(', ');

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>
            Where your {total} {total === 1 ? 'application stands' : 'applications stand'}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Page tests and the composed page render without the sidebar's provider. */}
        <TooltipProvider>
          <div role="img" aria-label={label} className="flex h-3.5 gap-0.5">
            {present.map((s, i) => (
              <Tooltip key={s}>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    data-status={s}
                    style={{ flexGrow: counts[s] }}
                    className={cn(
                      'block h-full basis-0 focus-visible:outline-2 focus-visible:outline-offset-2',
                      STATUS_COLOR_CLASS[s],
                      i === 0 && 'rounded-l',
                      i === present.length - 1 && 'rounded-r',
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {STATUS_LABELS[s]}: {counts[s]} ({Math.round((counts[s] / total) * 100)}%)
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
        {/* Every status is listed, zeros included, so the legend keeps its place as counts change. */}
        <ul aria-label="Statuses" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {APPLICATION_STATUSES.map((s) => {
            const body = (
              <>
                <span aria-hidden="true" className={cn('inline-block size-2.5 rounded-sm', STATUS_COLOR_CLASS[s])} />
                {STATUS_LABELS[s]} <span className="text-foreground tabular-nums">{counts[s]}</span>
              </>
            );
            return (
              <li key={s}>
                {counts[s] > 0 ? (
                  <Link
                    to={href(`/applications?status=${s}`)}
                    className="inline-flex items-center gap-1.5 hover:underline"
                  >
                    {body}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
