import { FUNNEL_STAGES, type DashboardSummary } from '../../../server/domain/dashboard.js';
import { STATUS_LABELS } from '../../labels.js';
import { AFTER_STEP } from './steps.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface FunnelCardProps {
  funnel: DashboardSummary['funnel'];
  rejectedAt: DashboardSummary['rejected_at'];
}

export function FunnelCard({ funnel, rejectedAt }: FunnelCardProps) {
  const top = funnel.applied;
  const pct = (n: number) => `${top > 0 ? (n / top) * 100 : 0}%`;
  const rejections = FUNNEL_STAGES.filter((stage) => rejectedAt[stage] > 0);

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
              const rejected = rejectedAt[stage];
              const reached = previous
                ? `${count} of ${above} that reached ${STATUS_LABELS[previous].toLowerCase()}`
                : `${count} ${count === 1 ? 'application' : 'applications'} sent`;
              const tip = rejected > 0 ? `${reached}; ${rejected} rejected after ${AFTER_STEP[stage]}` : reached;
              return (
                <li key={stage} className="grid grid-cols-[5.5rem_1fr_4.5rem] items-center gap-3">
                  <span>{STATUS_LABELS[stage]}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        data-testid="funnel-track"
                        className="block h-4 overflow-hidden rounded bg-muted"
                      >
                        {/* Rejections at this step are a part of its count, drawn red at the end of the fill. */}
                        <span className={`flex h-full ${rejected > 0 && count > rejected ? 'gap-0.5' : ''}`}>
                          <span
                            data-testid="funnel-reached"
                            className="block h-full rounded bg-status-interview"
                            style={{ width: pct(count - rejected) }}
                          />
                          {rejected > 0 && (
                            <span
                              data-testid="funnel-rejected"
                              className="block h-full rounded bg-status-rejected"
                              style={{ width: pct(rejected) }}
                            />
                          )}
                        </span>
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
        {/* Tooltips are hover-only, so the exact rejection counts are also given as text. */}
        {rejections.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full bg-status-rejected" />
            <span>
              Rejected after: {rejections.map((stage) => `${AFTER_STEP[stage]} ${rejectedAt[stage]}`).join(' · ')}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
