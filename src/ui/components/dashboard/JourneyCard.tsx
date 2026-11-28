import { useId, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  FUNNEL_STAGES,
  type DashboardSummary,
  type FunnelStage,
  type StageExit,
} from '../../../server/domain/dashboard.js';
import { STATUS_LABELS } from '../../labels.js';
import { ONE_TIME_VIEW } from '../../view-storage.js';
import { STATUS_COLOR_VAR } from './status-colors.js';
import { AFTER_STEP } from './steps.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface JourneyCardProps {
  funnel: DashboardSummary['funnel'];
  stoppedAt: DashboardSummary['stopped_at'];
  saved: number;
  // Where a branch links: the Applications it counts (SOW-0057). Null leaves the branch without a link.
  branchHref: (stage: FunnelStage, exit: StageExit) => string | null;
}

// Geometry in viewBox units; the drawing scales to the card width (SOW-0037, mockup option A).
const VIEW_W = 940;
const TOP = 48; // top of the trunk; stage headers sit above it
const TRUNK_H = 200; // height of the Applied bar
const MIN_H = 3; // thinnest bar or ribbon that still shows
const NODE_W = 14;
const NODE_X0 = 28;
// Spacing and exit length keep one stage's labels clear of the next stage's exits.
const NODE_GAP = 220;
const EXIT_DX = 136;
const EXIT_DROP = 26; // first exit's drop below the point it leaves
const EXIT_STEP = 14; // extra drop per following exit, so labels never collide
const CAP_W = 4;
const LABEL_GAP = 6;
// Room right of a cap for its label: "1000 no response" at font size 12. The last stage's exits are
// shortened to keep it, since nothing follows them.
const LABEL_ROOM = 120;
const PAD_BOTTOM = 10;
// The drawing's width in a 1280 px window; narrower, its labels would shrink below about 12 px
// (SOW-0037 Decision 7), so it keeps this width and the card scrolls sideways (SOW-0052 Decision 1).
export const JOURNEY_MIN_WIDTH_PX = 910;

const EXITS = ['waiting', 'rejected', 'no_response', 'withdrawn'] as const satisfies readonly StageExit[];
type Exit = (typeof EXITS)[number];

// Stops are statuses and read as their labels; waiting is any other status.
const exitWord = (exit: Exit) => (exit === 'waiting' ? 'waiting' : STATUS_LABELS[exit].toLowerCase());

// Stage and stop colours are the status tokens, waiting the stage's own; both themes recolour the drawing.
const exitColor = (stage: FunnelStage, exit: Exit) => STATUS_COLOR_VAR[exit === 'waiting' ? stage : exit];
// Still waiting is the stage's own colour, held back so the stops stand out.
const WAITING_ALPHA = 0.6;

interface ExitShape {
  exit: Exit;
  count: number;
  y: number; // where it leaves the node
  h: number;
  capY: number;
}

interface StageShape {
  stage: FunnelStage;
  x: number;
  count: number;
  share: number | null;
  nodeH: number;
  moved: { count: number; h: number } | null;
  exits: ExitShape[];
  bottom: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

function layout(funnel: DashboardSummary['funnel'], stoppedAt: DashboardSummary['stopped_at']): StageShape[] {
  const scale = funnel.applied > 0 ? TRUNK_H / funnel.applied : 0;
  const size = (n: number) => (n > 0 ? Math.max(MIN_H, n * scale) : 0);

  return FUNNEL_STAGES.map((stage, i) => {
    const count = funnel[stage];
    const previous = i > 0 ? funnel[FUNNEL_STAGES[i - 1]!] : 0;
    const next = FUNNEL_STAGES[i + 1];
    const movedCount = next ? funnel[next] : 0;
    const moved = movedCount > 0 ? { count: movedCount, h: size(movedCount) } : null;

    // Moving on leaves from the top of the node; the stops stack below it, each dropping further.
    let y = TOP + (moved?.h ?? 0);
    let drop = EXIT_DROP;
    const exits: ExitShape[] = [];
    for (const exit of EXITS) {
      const n = stoppedAt[stage][exit];
      if (n <= 0) continue;
      const h = size(n);
      exits.push({ exit, count: n, y, h, capY: y + drop });
      y += h;
      drop += EXIT_STEP;
    }
    // Minimum thicknesses can add up past the node's own height; grow the bar so no ribbon hangs below it.
    const nodeH = count > 0 ? Math.max(size(count), y - TOP) : 0;
    // A label is centred on its cap and reaches about 7 units below the cap's middle.
    const bottom = Math.max(TOP + nodeH, ...exits.map((e) => e.capY + Math.max(e.h, e.h / 2 + 7)));

    return {
      stage,
      x: NODE_X0 + i * NODE_GAP,
      count,
      share: i > 0 && previous > 0 ? Math.round((count / previous) * 100) : null,
      nodeH,
      moved,
      exits,
      bottom,
    };
  });
}

function ribbon(x0: number, top0: number, bottom0: number, x1: number, top1: number, bottom1: number): string {
  const m = round((x0 + x1) / 2);
  const [a, b, c, d, e, f] = [x0, top0, bottom0, x1, top1, bottom1].map(round);
  return `M${a},${b} C${m},${b} ${m},${e} ${d},${e} L${d},${f} C${m},${f} ${m},${c} ${a},${c} Z`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function exitLabel(stage: FunnelStage, exit: Exit, n: number): string {
  // At the last step, still waiting means holding the offer.
  if (stage === 'offer' && exit === 'waiting') return plural(n, 'offer', 'offers');
  return `${n} ${exitWord(exit)}`;
}

function exitTip(stage: FunnelStage, exit: Exit, n: number): string {
  if (stage === 'offer' && exit === 'waiting') return `${n} with an offer`;
  return `${n} ${exitWord(exit)} after ${AFTER_STEP[stage]}`;
}

// Starts with the visible label, so voice control finds the link by what it shows (WCAG 2.5.3, SOW-0057
// decision 10A); the offer's tooltip wording would not contain it.
function linkName(stage: FunnelStage, exit: Exit, n: number): string {
  return stage === 'offer' && exit === 'waiting' ? exitLabel(stage, exit, n) : exitTip(stage, exit, n);
}

function journeyLabel(shapes: StageShape[], sent: number): string {
  const stages = shapes
    .filter((s) => s.count > 0)
    .map((s) => {
      const name = `${STATUS_LABELS[s.stage]} ${s.count}`;
      const exits = s.exits.map((e) => exitLabel(s.stage, e.exit, e.count));
      return exits.length > 0 ? `${name}: ${exits.join(', ')}.` : `${name}.`;
    });
  return [`${sent} sent.`, ...stages].join(' ');
}

function Hover({ tip, children }: { tip: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

// A branch link shows it is one only on hover or keyboard focus (SOW-0057 decision 7A): the ribbon fades and
// the label is underlined. Chromium draws neither box-shadow rings nor outlines on an SVG link, so keyboard
// focus rings the ribbon with a stroke in the ring colour.
const BRANCH_LINK = 'group/branch cursor-pointer outline-none';
const BRANCH_RIBBON =
  'transition-opacity group-hover/branch:opacity-75 group-focus-visible/branch:opacity-75 group-focus-visible/branch:stroke-ring group-focus-visible/branch:stroke-2';
const BRANCH_LABEL = 'group-hover/branch:underline group-focus-visible/branch:underline';

export function JourneyCard({ funnel, stoppedAt, saved, branchHref }: JourneyCardProps) {
  const uid = useId().replace(/[^\w-]/g, '');
  const shapes = layout(funnel, stoppedAt);
  const height = Math.ceil(Math.max(TOP, ...shapes.map((s) => s.bottom)) + PAD_BOTTOM);
  const caption = saved > 0 ? `${funnel.applied} sent · ${saved} saved, not applied yet` : `${funnel.applied} sent`;
  const gradient = (key: string) => `${uid}-${key}`;
  const hoverable = 'cursor-default transition-opacity hover:opacity-75';

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Your applications' journey</h2>
        </CardTitle>
        <CardDescription>{caption}</CardDescription>
      </CardHeader>
      {/* Focusable so keyboards can scroll it in narrow windows; Safari gives scroll areas without
          focusable content no keyboard access (SOW-0052 Decision 6). */}
      <CardContent
        tabIndex={0}
        role="region"
        aria-label="Journey graph"
        className="overflow-x-auto rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {/* Page tests and the composed page render without the sidebar's provider. */}
        <TooltipProvider>
          {/* A group, not an image, so its branch links reach assistive tech (SOW-0057 decision 3A); its
              label still reads the whole journey. Stage bars and moved-on ribbons stay hover-only and
              outside the tab order (SOW-0034 Decision 7); every number is also a visible label. */}
          <svg
            role="group"
            aria-label={journeyLabel(shapes, funnel.applied)}
            viewBox={`0 0 ${VIEW_W} ${height}`}
            width="100%"
            style={{ minWidth: JOURNEY_MIN_WIDTH_PX }}
            className="block h-auto"
          >
            <defs>
              {shapes.map((s, i) => {
                const next = FUNNEL_STAGES[i + 1];
                return [
                  s.moved && next && (
                    <linearGradient key={`${s.stage}-moved`} id={gradient(`${s.stage}-moved`)}>
                      <stop offset="0" style={{ stopColor: STATUS_COLOR_VAR[s.stage], stopOpacity: 0.45 }} />
                      <stop offset="1" style={{ stopColor: STATUS_COLOR_VAR[next], stopOpacity: 0.45 }} />
                    </linearGradient>
                  ),
                  ...s.exits.map((e) => (
                    <linearGradient key={`${s.stage}-${e.exit}`} id={gradient(`${s.stage}-${e.exit}`)}>
                      <stop offset="0" style={{ stopColor: STATUS_COLOR_VAR[s.stage], stopOpacity: 0.35 }} />
                      <stop
                        offset="1"
                        style={{
                          stopColor: exitColor(s.stage, e.exit),
                          stopOpacity: e.exit === 'waiting' ? WAITING_ALPHA : 0.9,
                        }}
                      />
                    </linearGradient>
                  )),
                ];
              })}
            </defs>
            {shapes.map((s, i) => {
              const right = s.x + NODE_W;
              const capX = right + Math.min(EXIT_DX, VIEW_W - LABEL_ROOM - LABEL_GAP - CAP_W - right);
              return (
                <g key={s.stage} data-stage={s.stage}>
                  {/* Stage text is hidden from assistive tech: the group label already reads every stage
                      (SOW-0057 decision 11A). */}
                  <text
                    data-part="name"
                    aria-hidden="true"
                    x={s.x + NODE_W / 2}
                    y={TOP - 24}
                    textAnchor="middle"
                    fontSize={13}
                    fontWeight={700}
                    fill="currentColor"
                  >
                    {STATUS_LABELS[s.stage]}
                  </text>
                  <text
                    data-part="count"
                    aria-hidden="true"
                    x={s.x + NODE_W / 2}
                    y={TOP - 9}
                    textAnchor="middle"
                    fontSize={12}
                    className="fill-muted-foreground"
                  >
                    {s.count}
                    {s.share !== null && ` · ${s.share}%`}
                  </text>
                  {s.moved && (
                    <Hover tip={`${s.moved.count} moved on to ${STATUS_LABELS[FUNNEL_STAGES[i + 1]!].toLowerCase()}`}>
                      <path
                        data-part="moved"
                        d={ribbon(right, TOP, TOP + s.moved.h, NODE_X0 + (i + 1) * NODE_GAP, TOP, TOP + s.moved.h)}
                        fill={`url(#${gradient(`${s.stage}-moved`)})`}
                        className={hoverable}
                      />
                    </Hover>
                  )}
                  {s.exits.map((e) => {
                    const offer = s.stage === 'offer' && e.exit === 'waiting';
                    const color = exitColor(s.stage, e.exit);
                    const href = branchHref(s.stage, e.exit);
                    const branch = (
                      <>
                        <Hover tip={exitTip(s.stage, e.exit, e.count)}>
                          <path
                            d={ribbon(right, e.y, e.y + e.h, capX, e.capY, e.capY + e.h)}
                            fill={`url(#${gradient(`${s.stage}-${e.exit}`)})`}
                            className={href === null ? hoverable : BRANCH_RIBBON}
                          />
                        </Hover>
                        <rect
                          x={capX}
                          y={round(e.capY)}
                          width={CAP_W}
                          height={round(e.h)}
                          rx={CAP_W / 2}
                          style={{
                            fill: color,
                            fillOpacity: e.exit === 'waiting' ? WAITING_ALPHA : 1,
                          }}
                        />
                        <text
                          x={capX + CAP_W + LABEL_GAP}
                          y={round(e.capY + e.h / 2 + 4)}
                          fontSize={12}
                          fontWeight={offer ? 700 : undefined}
                          className={href === null ? undefined : BRANCH_LABEL}
                          // The offer colour is light in dark mode and dark in light mode, so it stays readable.
                          style={{ fill: offer ? STATUS_COLOR_VAR.offer : 'currentColor' }}
                        >
                          {exitLabel(s.stage, e.exit, e.count)}
                        </text>
                      </>
                    );
                    return (
                      <g key={e.exit} data-exit={e.exit}>
                        {href === null ? (
                          branch
                        ) : (
                          // Opens Applications as a one-time view, like a Dashboard tile (SOW-0054 decision 8B).
                          <Link
                            to={href}
                            state={ONE_TIME_VIEW}
                            aria-label={linkName(s.stage, e.exit, e.count)}
                            className={BRANCH_LINK}
                          >
                            {branch}
                          </Link>
                        )}
                      </g>
                    );
                  })}
                  {s.nodeH > 0 && (
                    <Hover tip={`${s.count} reached ${STATUS_LABELS[s.stage].toLowerCase()}`}>
                      <rect
                        data-part="node"
                        x={s.x}
                        y={TOP}
                        width={NODE_W}
                        height={round(s.nodeH)}
                        rx={4}
                        style={{ fill: STATUS_COLOR_VAR[s.stage] }}
                        className={hoverable}
                      />
                    </Hover>
                  )}
                </g>
              );
            })}
          </svg>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
