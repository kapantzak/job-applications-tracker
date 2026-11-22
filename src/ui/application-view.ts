// The Applications table columns and the key of the filter set that the Applications page and the
// Dashboard share per profile (SOW-0054).
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from '../server/domain/types.js';
import { STATUS_LABELS } from './labels.js';
import { type ColumnDef, orderIndex, type ViewState, viewQuery } from './table-view.js';

export const APPLICATION_COLUMNS: ColumnDef<Application>[] = [
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
  {
    id: 'applied',
    label: 'Applied',
    sortValue: (a) => a.applied_at,
    filter: { kind: 'date', value: (a) => a.applied_at },
  },
];

export const applicationViewKey = (profileId: string): string => `application-filters:${profileId}`;

// The Applications query for a tile: the shared view with status narrowed to the tile's statuses that
// the status filter keeps. Null when it keeps none, so the tile's 0 is not a link to a longer list.
export function tileQuery(state: ViewState, statuses: readonly ApplicationStatus[]): string | null {
  const chosen = state.filters.status;
  const shown = Array.isArray(chosen) ? statuses.filter((s) => chosen.includes(s)) : [...statuses];
  if (shown.length === 0) return null;
  return viewQuery({ ...state, filters: { ...state.filters, status: shown } }, APPLICATION_COLUMNS).toString();
}
