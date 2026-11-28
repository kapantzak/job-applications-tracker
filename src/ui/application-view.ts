// The Applications table columns and the key of the filter set that the Applications page and the
// Dashboard share per profile (SOW-0054).
import {
  FUNNEL_STAGES,
  furthestStep,
  historyByApplication,
  type FunnelStage,
  type HistoryRow,
} from '../server/domain/dashboard.js';
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from '../server/domain/types.js';
import { STATUS_LABELS } from './labels.js';
import { type ColumnDef, orderIndex, type ViewState, viewQuery } from './table-view.js';

// An application with the furthest step it reached, for the "Furthest step" filter (SOW-0057).
export type ApplicationRow = Application & { reached: FunnelStage | null };

export function applicationRows(apps: Application[], history: HistoryRow[]): ApplicationRow[] {
  const byApp = historyByApplication(history);
  return apps.map((a) => ({ ...a, reached: furthestStep(a.status, byApp.get(a.id) ?? []) }));
}

export const APPLICATION_COLUMNS: ColumnDef<ApplicationRow>[] = [
  {
    id: 'company',
    label: 'Company',
    sortValue: (a) => a.company,
    searchText: (a) => a.company,
    filter: { kind: 'values', value: (a) => a.company },
  },
  {
    id: 'role',
    label: 'Role',
    sortValue: (a) => a.role,
    searchText: (a) => a.role,
    filter: { kind: 'text', value: (a) => a.role },
  },
  {
    id: 'status',
    label: 'Status',
    sortValue: (a) => orderIndex(APPLICATION_STATUSES, a.status),
    filter: {
      kind: 'values',
      value: (a) => a.status,
      order: APPLICATION_STATUSES,
      optionLabel: (v) => STATUS_LABELS[v as ApplicationStatus] ?? v,
    },
  },
  // Filter only, no table column (SOW-0057 decision 4A); Journey branches link to it.
  {
    id: 'reached',
    label: 'Furthest step',
    filter: {
      kind: 'values',
      value: (a) => a.reached,
      order: FUNNEL_STAGES,
      optionLabel: (v) => STATUS_LABELS[v as FunnelStage] ?? v,
      emptyLabel: 'Not sent',
    },
  },
  {
    id: 'applied',
    label: 'Applied',
    sortValue: (a) => a.applied_at,
    filter: { kind: 'date', value: (a) => a.applied_at },
  },
];

export const applicationViewKey = (profileId: string): string => `application-filters:${profileId}`;

// The values of `values` that the view's filter on `id` keeps; all of them when it has none.
function kept(state: ViewState, id: string, values: readonly string[]): string[] {
  const chosen = state.filters[id];
  return Array.isArray(chosen) ? values.filter((v) => chosen.includes(v)) : [...values];
}

// The Applications query for a tile: the shared view with status narrowed to the tile's statuses that
// the status filter keeps. Null when it keeps none, so the tile's 0 is not a link to a longer list.
export function tileQuery(state: ViewState, statuses: readonly ApplicationStatus[]): string | null {
  const status = kept(state, 'status', statuses);
  if (status.length === 0) return null;
  return viewQuery({ ...state, filters: { ...state.filters, status } }, APPLICATION_COLUMNS).toString();
}

// The Applications query for a Journey branch (SOW-0057): like a tile, with Furthest step narrowed to the
// branch's stage too. Null when the filters keep none of them.
export function branchQuery(state: ViewState, stage: FunnelStage, statuses: readonly ApplicationStatus[]): string | null {
  const status = kept(state, 'status', statuses);
  const reached = kept(state, 'reached', [stage]);
  if (status.length === 0 || reached.length === 0) return null;
  return viewQuery({ ...state, filters: { ...state.filters, status, reached } }, APPLICATION_COLUMNS).toString();
}
