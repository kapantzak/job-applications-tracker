import { FUNNEL_STAGES, type DashboardSummary } from '../../../server/domain/dashboard.js';
import { STATUS_LABELS } from '../../labels.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface FunnelCardProps {
  funnel: DashboardSummary['funnel'];
}

export function FunnelCard({ funnel }: FunnelCardProps) {
  const top = funnel.applied;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          <h2>How far applications get</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <TooltipProvider>
          <ul aria-label="Funnel steps" className="flex flex-col gap-2 text-sm">
            {FUNNEL_STAGES.map((stage, i) => {
              const count = funnel[stage];
              const previous = i > 0 ? FUNNEL_STAGES[i - 1] : null;
              const above = previous ? funnel[previous] : 0;
              // A share of an empty step means nothing, so it is left out rather than shown as 0% or NaN.
              const share = previous && above > 0 ? Math.round((count / above) * 100) : null;
              const tip = previous
                ? `${count} of ${above} that reached ${STATUS_LABELS[previous].toLowerCase()}`
                : `${count} ${count === 1 ? 'application' : 'applications'} sent`;
              return (
                <li key={stage} className="grid grid-cols-[5.5rem_1fr_4.5rem] items-center gap-3">
                  <span>{STATUS_LABELS[stage]}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        data-testid="funnel-track"
                        className="block h-4 overflow-hidden rounded bg-muted"
                      >
                        <span
                          className="block h-full rounded bg-status-interview"
                          style={{ width: `${top > 0 ? (count / top) * 100 : 0}%` }}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{tip}</TooltipContent>
                  </Tooltip>
                  <span className="flex items-baseline justify-end gap-1.5 tabular-nums">
                    <span>{count}</span>
                    {share !== null && <span className="text-xs text-muted-foreground">{share}%</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </TooltipProvider>
        <p className="text-xs text-muted-foreground">% = share of the step above</p>
      </CardContent>
    </Card>
  );
}
