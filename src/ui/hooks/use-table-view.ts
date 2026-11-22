import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  applyView,
  type ColumnDef,
  type FilterValue,
  hasView,
  isFiltered,
  nextSort,
  parseView,
  type ViewState,
  viewQuery,
  writeView,
} from '../table-view.js';
import { isOneTimeView, ONE_TIME_VIEW, readStoredView, storeView } from '../view-storage.js';

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

type ViewUpdate = (change: (s: ViewState) => ViewState) => void;

// The view over a state that lives elsewhere (URL or storage); `update` applies a change to it.
function useViewOver<Row>(columns: ColumnDef<Row>[], rows: Row[], params: URLSearchParams, update: ViewUpdate): TableView<Row> {
  const state = useMemo(() => parseView(params, columns), [params, columns]);
  const visible = useMemo(() => applyView(rows, columns, state), [rows, columns, state]);
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

// `columns` must be stable (a module constant), or every render re-filters.
export function useTableView<Row>(columns: ColumnDef<Row>[], rows: Row[]): TableView<Row> {
  const [params, setParams] = useSearchParams();
  // Replace, not push: typing in the search box must not fill the browser history.
  const update = useCallback<ViewUpdate>(
    (change) => setParams((prev) => writeView(change(parseView(prev, columns)), columns, prev), { replace: true }),
    [setParams, columns],
  );
  return useViewOver(columns, rows, params, update);
}

// The Applications page (SOW-0054, decisions 7A and 8B): the view stays in the URL and is saved under
// `storageKey` too. A URL without a view loads the saved one; a URL with one is saved, except a one-time
// view opened from a Dashboard tile, which is saved only once the user changes it.
export function useSharedTableView<Row>(columns: ColumnDef<Row>[], rows: Row[], storageKey: string): TableView<Row> {
  const [params, setParams] = useSearchParams();
  const oneTime = isOneTimeView(useLocation().state);
  // Saved here, not only by the effect below: a Reset leaves an empty URL, which would load the old view back.
  const update = useCallback<ViewUpdate>(
    (change) =>
      setParams(
        (prev) => {
          const next = change(parseView(prev, columns));
          storeView(storageKey, next, columns);
          return writeView(next, columns, prev);
        },
        { replace: true },
      ),
    [setParams, columns, storageKey],
  );
  useEffect(() => {
    if (oneTime) return;
    if (hasView(params, columns)) {
      storeView(storageKey, parseView(params, columns), columns);
      return;
    }
    const stored = readStoredView(storageKey, columns);
    if (hasView(stored, columns)) setParams(writeView(parseView(stored, columns), columns, params), { replace: true });
  }, [params, oneTime, columns, storageKey, setParams]);
  return useViewOver(columns, rows, params, update);
}

// The Dashboard (SOW-0054): the view lives only in storage, so the page URL stays plain.
export function useStoredTableView<Row>(columns: ColumnDef<Row>[], rows: Row[], storageKey: string): TableView<Row> {
  const [stored, setStored] = useState(() => ({ key: storageKey, params: readStoredView(storageKey, columns) }));
  let params = stored.params;
  if (stored.key !== storageKey) {
    params = readStoredView(storageKey, columns);
    setStored({ key: storageKey, params });
  }
  const current = useRef(params);
  current.current = params;
  const update = useCallback<ViewUpdate>(
    (change) => {
      const next = change(parseView(current.current, columns));
      storeView(storageKey, next, columns);
      current.current = viewQuery(next, columns);
      setStored({ key: storageKey, params: current.current });
    },
    [columns, storageKey],
  );
  return useViewOver(columns, rows, params, update);
}

// A list passes its query to the detail pages it links to, so their back link returns to the same view;
// a one-time view stays one-time on the way back (SOW-0054).
interface ListReturnState {
  listSearch?: unknown;
  listOneTimeView?: unknown;
}

export function useListLinkState(): ListReturnState {
  const location = useLocation();
  return isOneTimeView(location.state)
    ? { listSearch: location.search, listOneTimeView: true }
    : { listSearch: location.search };
}

export function useListReturnHref(listHref: string): string {
  const search = (useLocation().state as ListReturnState | null)?.listSearch;
  return typeof search === 'string' && search.startsWith('?') ? `${listHref}${search}` : listHref;
}

// The location state for the back link: the one-time marker when the list was a one-time view.
export function useListReturnState(): typeof ONE_TIME_VIEW | undefined {
  return (useLocation().state as ListReturnState | null)?.listOneTimeView === true ? ONE_TIME_VIEW : undefined;
}
