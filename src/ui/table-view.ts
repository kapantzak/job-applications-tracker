// Sorting, search and filters for the list tables (SOW-0029). Pure functions over loaded rows; the
// state lives in the page URL so it survives leaving the page and coming back.

export type SortValue = string | number | null;

export type FilterSpec<Row> =
  // A checklist of the values found in the rows. `null` and '' share the "empty" option.
  | {
      kind: 'values';
      value: (row: Row) => string | null;
      optionLabel?: (value: string) => string;
      // Options follow this order when given (statuses), else they sort by label.
      order?: readonly string[];
      emptyLabel?: string;
    }
  | { kind: 'text'; value: (row: Row) => string | null }
  | { kind: 'date'; value: (row: Row) => string | null };

export interface ColumnDef<Row> {
  // Also the URL query key; `q` and `sort` are reserved.
  id: string;
  label: string;
  sortValue?: (row: Row) => SortValue;
  searchText?: (row: Row) => string | null;
  filter?: FilterSpec<Row>;
}

// Local calendar days as YYYY-MM-DD; either end may be open.
export interface DateRange {
  from: string | null;
  to: string | null;
}

export type FilterValue = string[] | string | DateRange;

export interface SortState {
  id: string;
  desc: boolean;
}

export interface ViewState {
  q: string;
  sort: SortState | null;
  filters: Record<string, FilterValue>;
}

export const EMPTY_VIEW: ViewState = { q: '', sort: null, filters: {} };

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_SEPARATOR = '..';

export const orderIndex = (order: readonly string[], value: string): number => order.indexOf(value);

export function toIsoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Parsed as a local date: `new Date('YYYY-MM-DD')` would be UTC midnight and shift the day.
export function fromIsoDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function parseRange(raw: string): DateRange | null {
  const parts = raw.split(RANGE_SEPARATOR);
  if (parts.length !== 2) return null;
  // A real calendar day only: 2026-02-30 would otherwise roll over into March.
  const isDay = (p: string) => DAY.test(p) && toIsoDay(fromIsoDay(p)) === p;
  const [from, to] = parts.map((p) => (isDay(p!) ? p! : p === '' ? null : undefined));
  if (from === undefined || to === undefined || (from === null && to === null)) return null;
  // A hand-edited reversed range would match nothing; read it the right way round.
  return from && to && from > to ? { from: to, to: from } : { from, to };
}

// Whitespace-only text means no search or filter; other text is kept as typed.
export const canonicalText = (text: string): string => (text.trim() ? text : '');

export function parseView<Row>(params: URLSearchParams, columns: ColumnDef<Row>[]): ViewState {
  const state: ViewState = { q: canonicalText(params.get('q') ?? ''), sort: null, filters: {} };
  const rawSort = params.get('sort');
  if (rawSort) {
    const desc = rawSort.startsWith('-');
    const id = desc ? rawSort.slice(1) : rawSort;
    if (columns.some((c) => c.id === id && c.sortValue)) state.sort = { id, desc };
  }
  for (const column of columns) {
    const filter = column.filter;
    if (!filter || !params.has(column.id)) continue;
    if (filter.kind === 'values') {
      state.filters[column.id] = [...new Set(params.getAll(column.id))];
    } else if (filter.kind === 'text') {
      const text = canonicalText(params.get(column.id) ?? '');
      if (text) state.filters[column.id] = text;
    } else {
      const range = parseRange(params.get(column.id) ?? '');
      if (range) state.filters[column.id] = range;
    }
  }
  return state;
}

export function writeView<Row>(state: ViewState, columns: ColumnDef<Row>[], base: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base);
  next.delete('q');
  next.delete('sort');
  for (const column of columns) next.delete(column.id);
  if (canonicalText(state.q)) next.set('q', state.q);
  if (state.sort) next.set('sort', `${state.sort.desc ? '-' : ''}${state.sort.id}`);
  for (const column of columns) {
    const value = state.filters[column.id];
    if (value === undefined || !column.filter) continue;
    if (Array.isArray(value)) {
      for (const v of value) next.append(column.id, v);
    } else if (typeof value === 'string') {
      if (canonicalText(value)) next.set(column.id, value);
    } else if (value.from || value.to) {
      next.set(column.id, `${value.from ?? ''}${RANGE_SEPARATOR}${value.to ?? ''}`);
    }
  }
  return next;
}

const contains = (text: string | null, needle: string) => !!text && text.toLowerCase().includes(needle);

function inRange(value: string | null, range: DateRange): boolean {
  const time = value ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) return false;
  if (range.from && time < fromIsoDay(range.from).getTime()) return false;
  if (range.to) {
    const end = fromIsoDay(range.to);
    end.setDate(end.getDate() + 1);
    if (time >= end.getTime()) return false;
  }
  return true;
}

function matches<Row>(row: Row, column: ColumnDef<Row>, value: FilterValue): boolean {
  const filter = column.filter!;
  if (filter.kind === 'values') return (value as string[]).includes(filter.value(row) ?? '');
  if (filter.kind === 'text') return contains(filter.value(row), (value as string).trim().toLowerCase());
  return inRange(filter.value(row), value as DateRange);
}

// Dates sort by time; other strings ignore case and compare numbers inside text ("SRE 9" < "SRE 10").
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function applyView<Row>(rows: Row[], columns: ColumnDef<Row>[], state: ViewState): Row[] {
  const needle = state.q.trim().toLowerCase();
  const active = columns.filter((c) => c.filter && state.filters[c.id] !== undefined);
  const searchable = columns.filter((c) => c.searchText);
  const visible = rows.filter(
    (row) =>
      (!needle || searchable.some((c) => contains(c.searchText!(row), needle))) &&
      active.every((c) => matches(row, c, state.filters[c.id]!)),
  );
  const sortColumn = state.sort && columns.find((c) => c.id === state.sort!.id && c.sortValue);
  if (!sortColumn) return visible;
  const isDate = sortColumn.filter?.kind === 'date';
  const key = (row: Row): SortValue => {
    const v = sortColumn.sortValue!(row);
    if (v === null || v === '') return null;
    if (isDate && typeof v === 'string') {
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : t;
    }
    return v;
  };
  const sign = state.sort!.desc ? -1 : 1;
  // Array.prototype.sort is stable, so ties keep the server's newest-first order.
  return visible
    .map((row) => ({ row, k: key(row) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? 0 : a.k === null ? 1 : -1;
      const diff = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : collator.compare(String(a.k), String(b.k));
      return sign * diff;
    })
    .map((x) => x.row);
}

export function facetOptions<Row>(rows: Row[], column: ColumnDef<Row>, selected: string[]): FacetOption[] {
  const filter = column.filter;
  if (filter?.kind !== 'values') return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = filter.value(row) ?? '';
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  for (const v of selected) if (!counts.has(v)) counts.set(v, 0);
  const label = (v: string) => (v === '' ? (filter.emptyLabel ?? 'None') : (filter.optionLabel?.(v) ?? v));
  const options = [...counts].map(([value, count]) => ({ value, label: label(value), count }));
  const rank = (o: FacetOption) => {
    if (o.value === '') return Number.MAX_SAFE_INTEGER;
    const i = filter.order ? filter.order.indexOf(o.value) : -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };
  return options.sort((a, b) => rank(a) - rank(b) || collator.compare(a.label, b.label));
}

export function nextSort(current: SortState | null, id: string): SortState | null {
  if (current?.id !== id) return { id, desc: false };
  return current.desc ? null : { id, desc: true };
}

export const isFiltered = (state: ViewState): boolean => !!state.q.trim() || Object.keys(state.filters).length > 0;

const dayLabel = (day: string) => fromIsoDay(day).toLocaleDateString(undefined, { dateStyle: 'medium' });

export function dateRangeLabel(range: DateRange): string {
  if (range.from && range.to) {
    return range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
  }
  return range.from ? `From ${dayLabel(range.from)}` : `Until ${dayLabel(range.to!)}`;
}
