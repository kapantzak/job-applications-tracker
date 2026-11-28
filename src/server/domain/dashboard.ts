// Per-profile dashboard rules (SOW-0034). Pure functions, so the route and the tests share one definition.
import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationStatus,
  type StatusHistoryEntry,
} from './types.js';

export const QUIET_DAYS = 14;
export const FUNNEL_STAGES = ['applied', 'screening', 'interview', 'offer'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export type QuietStatus = 'applied' | 'screening' | 'interview';

// How the applications that stopped at a step ended there; `waiting` is any other status (SOW-0037).
export interface StageStops {
  waiting: number;
  rejected: number;
  no_response: number;
  withdrawn: number;
}

export interface QuietApplication {
  id: string;
  company: string;
  role: string;
  status: QuietStatus;
  since: string;
  days: number;
}

export interface DashboardSummary {
  total: number;
  status_counts: Record<ApplicationStatus, number>;
  funnel: Record<FunnelStage, number>;
  // Sent applications by the furthest step they reached and how they stopped there;
  // each step sums to funnel[step] - funnel[next step].
  stopped_at: Record<FunnelStage, StageStops>;
  pending_proposals: number;
  quiet: QuietApplication[];
  quiet_days: number;
}

// What the dashboard route returns: the summary plus the new applications Gmail sync proposed (SOW-0045).
export type DashboardResponse = DashboardSummary & { pending_new_applications: number };

export type HistoryRow = Pick<StatusHistoryEntry, 'application_id' | 'from_status' | 'to_status' | 'changed_at'>;

const DAY_MS = 86_400_000;
const QUIET_STATUSES: readonly ApplicationStatus[] = ['applied', 'screening', 'interview'];

// Funnel depth of a status; 0 means never applied. Rejected and no_response show only that an
// application was sent, so they count as applied; withdrawn is ambiguous and counts as nothing.
function rank(status: ApplicationStatus): number {
  const index = (FUNNEL_STAGES as readonly string[]).indexOf(status);
  if (index >= 0) return index + 1;
  return status === 'rejected' || status === 'no_response' ? 1 : 0;
}

function isQuietStatus(status: ApplicationStatus): status is QuietStatus {
  return QUIET_STATUSES.includes(status);
}

// Statuses that end an application at its furthest step; any other status is still waiting there.
export const STOP_STATUSES = ['rejected', 'no_response', 'withdrawn'] as const satisfies readonly ApplicationStatus[];
export type StageExit = keyof StageStops;
type StopStatus = (typeof STOP_STATUSES)[number];
const isStop = (status: ApplicationStatus): status is StopStatus => (STOP_STATUSES as readonly string[]).includes(status);

// The statuses a Journey branch counts (SOW-0057), so a link to the branch lists the same applications.
export function exitStatuses(exit: StageExit): ApplicationStatus[] {
  if (exit !== 'waiting') return [exit];
  return APPLICATION_STATUSES.filter((s) => !isStop(s));
}

// Each application's history rows, keeping the route's oldest-first order.
export function historyByApplication(history: HistoryRow[]): Map<string, HistoryRow[]> {
  const byApp = new Map<string, HistoryRow[]>();
  for (const h of history) {
    const rows = byApp.get(h.application_id);
    if (rows) rows.push(h);
    else byApp.set(h.application_id, [h]);
  }
  return byApp;
}

// The furthest funnel step an application reached; null when it was never sent. `rows` is its own history,
// oldest first. The Dashboard and the Applications "Furthest step" filter share this rule (SOW-0057).
export function furthestStep(status: ApplicationStatus, rows: HistoryRow[]): FunnelStage | null {
  // Creating an application writes no history row, so its starting status is only a from_status. Every row's
  // from_status counts, not only the earliest: a merge interleaves histories (SOW-0057 decision 9A).
  const held: ApplicationStatus[] = [status];
  for (const r of rows) {
    if (r.from_status) held.push(r.from_status);
    held.push(r.to_status);
  }
  const reach = Math.max(...held.map(rank));
  return reach >= 1 ? FUNNEL_STAGES[reach - 1]! : null;
}

// `history` arrives ordered by changed_at, then insertion; the first row per application is its earliest.
export function summarizeDashboard(
  apps: Application[],
  history: HistoryRow[],
  pendingProposals: number,
  now: Date,
): DashboardSummary {
  const byApp = historyByApplication(history);

  const status_counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<
    ApplicationStatus,
    number
  >;
  const funnel: Record<FunnelStage, number> = { applied: 0, screening: 0, interview: 0, offer: 0 };
  const stopped_at = Object.fromEntries(
    FUNNEL_STAGES.map((stage) => [stage, { waiting: 0, rejected: 0, no_response: 0, withdrawn: 0 }]),
  ) as Record<FunnelStage, StageStops>;
  const quiet: QuietApplication[] = [];

  for (const a of apps) {
    status_counts[a.status] += 1;
    const rows = byApp.get(a.id) ?? [];

    const reached = furthestStep(a.status, rows);
    const reach = reached ? FUNNEL_STAGES.indexOf(reached) + 1 : 0;
    FUNNEL_STAGES.forEach((stage, i) => {
      if (reach >= i + 1) funnel[stage] += 1;
    });
    if (reached) {
      const stops = stopped_at[reached];
      if (isStop(a.status)) stops[a.status] += 1;
      else stops.waiting += 1;
    }

    if (!isQuietStatus(a.status)) continue;
    // A backdated Applied date is the real clock until a status change is recorded.
    const since =
      rows.length === 0 && a.status === 'applied' ? (a.applied_at ?? a.status_changed_at) : a.status_changed_at;
    const days = Math.floor((now.getTime() - Date.parse(since)) / DAY_MS);
    if (days >= QUIET_DAYS) {
      quiet.push({ id: a.id, company: a.company, role: a.role, status: a.status, since, days });
    }
  }

  quiet.sort((x, y) => y.days - x.days);
  return {
    total: apps.length,
    status_counts,
    funnel,
    stopped_at,
    pending_proposals: pendingProposals,
    quiet,
    quiet_days: QUIET_DAYS,
  };
}
