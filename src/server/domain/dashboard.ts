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
  pending_proposals: number;
  quiet: QuietApplication[];
  quiet_days: number;
}

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

// `history` arrives ordered by changed_at, then insertion; the first row per application is its earliest.
export function summarizeDashboard(
  apps: Application[],
  history: HistoryRow[],
  pendingProposals: number,
  now: Date,
): DashboardSummary {
  const byApp = new Map<string, HistoryRow[]>();
  for (const h of history) {
    const rows = byApp.get(h.application_id);
    if (rows) rows.push(h);
    else byApp.set(h.application_id, [h]);
  }

  const status_counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<
    ApplicationStatus,
    number
  >;
  const funnel: Record<FunnelStage, number> = { applied: 0, screening: 0, interview: 0, offer: 0 };
  const quiet: QuietApplication[] = [];

  for (const a of apps) {
    status_counts[a.status] += 1;
    const rows = byApp.get(a.id) ?? [];

    // Creating an application writes no history row, so the starting status is the earliest row's from_status.
    const held: ApplicationStatus[] = [a.status];
    const first = rows[0];
    if (first?.from_status) held.push(first.from_status);
    for (const r of rows) held.push(r.to_status);
    const reach = Math.max(...held.map(rank));
    FUNNEL_STAGES.forEach((stage, i) => {
      if (reach >= i + 1) funnel[stage] += 1;
    });

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
    pending_proposals: pendingProposals,
    quiet,
    quiet_days: QUIET_DAYS,
  };
}
