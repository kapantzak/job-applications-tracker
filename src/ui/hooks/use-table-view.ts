import { useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  applyView,
  type ColumnDef,
  type FilterValue,
  isFiltered,
  nextSort,
  parseView,
  type ViewState,
  writeView,
} from '../table-view.js';

export interface TableView<Row> {
  columns: ColumnDef<Row>[];
  state: ViewState;
  // All loaded rows (for filter counts) and the rows left after search, filters and sort.
  rows: Row[];
  visible: Row[];
  filtered: boolean;
  setQuery: (q: string) => void;
  toggleSort: (id: string) => void;
  setFilter: (id: string, value: FilterValue | null) => void;
  // Clears search and filters; the sort stays.
  reset: () => void;
}

// `columns` must be stable (a module constant), or every render re-filters.
export function useTableView<Row>(columns: ColumnDef<Row>[], rows: Row[]): TableView<Row> {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseView(params, columns), [params, columns]);
  const visible = useMemo(() => applyView(rows, columns, state), [rows, columns, state]);

  // Replace, not push: typing in the search box must not fill the browser history.
  const update = useCallback(
    (change: (s: ViewState) => ViewState) =>
      setParams((prev) => writeView(change(parseView(prev, columns)), columns, prev), { replace: true }),
    [setParams, columns],
  );

  return {
    columns,
    state,
    rows,
    visible,
    filtered: isFiltered(state),
    setQuery: useCallback((q: string) => update((s) => ({ ...s, q })), [update]),
    toggleSort: useCallback((id: string) => update((s) => ({ ...s, sort: nextSort(s.sort, id) })), [update]),
    setFilter: useCallback(
      (id: string, value: FilterValue | null) =>
        update((s) => {
          const filters = { ...s.filters };
          const empty = value === null || (Array.isArray(value) && value.length === 0) || value === '';
          if (empty) delete filters[id];
          else filters[id] = value;
          return { ...s, filters };
        }),
      [update],
    ),
    reset: useCallback(() => update((s) => ({ ...s, q: '', filters: {} })), [update]),
  };
}

// A list passes its query to the detail pages it links to, so their back link returns to the same view.
interface ListReturnState {
  listSearch?: unknown;
}

export function useListLinkState(): ListReturnState {
  return { listSearch: useLocation().search };
}

export function useListReturnHref(listHref: string): string {
  const search = (useLocation().state as ListReturnState | null)?.listSearch;
  return typeof search === 'string' && search.startsWith('?') ? `${listHref}${search}` : listHref;
}
