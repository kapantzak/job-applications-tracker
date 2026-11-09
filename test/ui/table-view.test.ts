import { describe, expect, it } from 'vitest';
import {
  applyView,
  type ColumnDef,
  type DateRange,
  dateRangeLabel,
  EMPTY_VIEW,
  facetOptions,
  isFiltered,
  nextSort,
  orderIndex,
  parseView,
  toIsoDay,
  writeView,
} from '../../src/ui/table-view.js';

interface Row {
  id: string;
  company: string;
  title: string;
  location: string | null;
  status: 'saved' | 'applied' | 'offer';
  at: string | null;
}

const STATUS_ORDER = ['saved', 'applied', 'offer'] as const;

const COLUMNS: ColumnDef<Row>[] = [
  {
    id: 'company',
    label: 'Company',
    sortValue: (r) => r.company,
    searchText: (r) => r.company,
    filter: { kind: 'values', value: (r) => r.company },
  },
  { id: 'title', label: 'Title', sortValue: (r) => r.title, searchText: (r) => r.title, filter: { kind: 'text', value: (r) => r.title } },
  {
    id: 'location',
    label: 'Location',
    sortValue: (r) => r.location,
    searchText: (r) => r.location,
    filter: { kind: 'values', value: (r) => r.location, emptyLabel: 'No location' },
  },
  {
    id: 'status',
    label: 'Status',
    sortValue: (r) => orderIndex(STATUS_ORDER, r.status),
    filter: { kind: 'values', value: (r) => r.status, order: STATUS_ORDER, optionLabel: (v) => v.toUpperCase() },
  },
  { id: 'at', label: 'At', sortValue: (r) => r.at, filter: { kind: 'date', value: (r) => r.at } },
];

const row = (over: Partial<Row>): Row => ({
  id: 'x',
  company: 'Acme',
  title: 'Engineer',
  location: 'Remote',
  status: 'saved',
  at: '2026-11-03T10:00:00',
  ...over,
});

const ROWS: Row[] = [
  row({ id: 'a', company: 'acme', title: 'Platform Engineer', location: 'Berlin', status: 'applied', at: '2026-11-05T09:00:00' }),
  row({ id: 'b', company: 'Globex', title: 'Data Engineer', location: null, status: 'offer', at: null }),
  row({ id: 'c', company: 'Initech', title: 'SRE 10', location: 'Remote', status: 'saved', at: '2026-11-01T23:30:00' }),
  row({ id: 'd', company: 'Initech', title: 'SRE 9', location: 'Remote', status: 'applied', at: 'soon' }),
];

const ids = (rows: Row[]) => rows.map((r) => r.id);
const view = (search: string) => parseView(new URLSearchParams(search), COLUMNS);

describe('parseView and writeView', () => {
  it('reads search, sort and every filter kind from the query', () => {
    expect(view('q=eng&sort=-company&company=Acme&company=Globex&title=sre&at=2026-11-01..2026-11-07')).toEqual({
      q: 'eng',
      sort: { id: 'company', desc: true },
      filters: {
        company: ['Acme', 'Globex'],
        title: 'sre',
        at: { from: '2026-11-01', to: '2026-11-07' },
      },
    });
  });

  it('keeps an empty value as the "empty" option of a values filter', () => {
    expect(view('location=').filters).toEqual({ location: [''] });
  });

  it('accepts open-ended date ranges and ignores malformed ones', () => {
    expect(view('at=2026-11-01..').filters).toEqual({ at: { from: '2026-11-01', to: null } });
    expect(view('at=..2026-11-07').filters).toEqual({ at: { from: null, to: '2026-11-07' } });
    expect(view('at=yesterday').filters).toEqual({});
    expect(view('at=..').filters).toEqual({});
    expect(view('at=2026-02-30..').filters).toEqual({});
    expect(view('at=2026-11-07..2026-11-01').filters).toEqual({ at: { from: '2026-11-01', to: '2026-11-07' } });
  });

  it('ignores unknown keys, unsortable columns and blank text', () => {
    expect(view('sort=nope&other=1&title=%20%20')).toEqual(EMPTY_VIEW);
  });

  it('writes no whitespace-only search or text filter', () => {
    const written = writeView({ q: '  ', sort: null, filters: { title: ' ' } }, COLUMNS, new URLSearchParams());
    expect(written.toString()).toBe('');
  });

  it('round-trips a state and keeps query keys it does not own', () => {
    const state = view('q=eng&sort=at&location=&location=Berlin&title=sre&at=..2026-11-07');
    const written = writeView(state, COLUMNS, new URLSearchParams('tab=1&company=Old'));
    expect(written.get('tab')).toBe('1');
    expect(written.getAll('company')).toEqual([]);
    expect(parseView(written, COLUMNS)).toEqual(state);
  });
});

describe('applyView', () => {
  it('keeps the incoming order with no sort', () => {
    expect(ids(applyView(ROWS, COLUMNS, EMPTY_VIEW))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('searches the search columns case-insensitively', () => {
    expect(ids(applyView(ROWS, COLUMNS, view('q=  ACME ')))).toEqual(['a']);
    expect(ids(applyView(ROWS, COLUMNS, view('q=remote')))).toEqual(['c', 'd']);
  });

  it('matches any selected value, including the empty option', () => {
    expect(ids(applyView(ROWS, COLUMNS, view('location=&location=Berlin')))).toEqual(['a', 'b']);
  });

  it('matches text filters as a case-insensitive substring', () => {
    expect(ids(applyView(ROWS, COLUMNS, view('title=data')))).toEqual(['b']);
  });

  it('combines search and filters', () => {
    expect(ids(applyView(ROWS, COLUMNS, view('q=engineer&status=applied')))).toEqual(['a']);
  });

  it('includes both ends of a date range in local days and drops rows without a usable date', () => {
    expect(ids(applyView(ROWS, COLUMNS, view('at=2026-11-01..2026-11-05')))).toEqual(['a', 'c']);
    expect(ids(applyView(ROWS, COLUMNS, view('at=2026-11-02..')))).toEqual(['a']);
    expect(ids(applyView(ROWS, COLUMNS, view('at=..2026-11-01')))).toEqual(['c']);
  });

  it('sorts strings ignoring case and numbers within text', () => {
    expect(ids(applyView(ROWS, COLUMNS, view('sort=company')))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(applyView(ROWS, COLUMNS, view('sort=title&company=Initech')))).toEqual(['d', 'c']);
  });

  it('sorts by a given order and keeps ties in incoming order', () => {
    expect(ids(applyView(ROWS, COLUMNS, view('sort=status')))).toEqual(['c', 'a', 'd', 'b']);
    expect(ids(applyView(ROWS, COLUMNS, view('sort=-status')))).toEqual(['b', 'a', 'd', 'c']);
  });

  it('puts empty and unparseable values last in both directions', () => {
    expect(ids(applyView(ROWS, COLUMNS, view('sort=at')))).toEqual(['c', 'a', 'b', 'd']);
    expect(ids(applyView(ROWS, COLUMNS, view('sort=-at')))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(applyView(ROWS, COLUMNS, view('sort=-location')))).toEqual(['c', 'd', 'a', 'b']);
  });

  it('does not change the input array', () => {
    const input = [...ROWS];
    applyView(input, COLUMNS, view('sort=-company'));
    expect(ids(input)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('facetOptions', () => {
  const values = (id: string) => COLUMNS.find((c) => c.id === id)!;

  it('counts every loaded row, sorted by label, with the empty option last', () => {
    expect(facetOptions(ROWS, values('location'), [])).toEqual([
      { value: 'Berlin', label: 'Berlin', count: 1 },
      { value: 'Remote', label: 'Remote', count: 2 },
      { value: '', label: 'No location', count: 1 },
    ]);
  });

  it('follows the column order and labels when given', () => {
    expect(facetOptions(ROWS, values('status'), [])).toEqual([
      { value: 'saved', label: 'SAVED', count: 1 },
      { value: 'applied', label: 'APPLIED', count: 2 },
      { value: 'offer', label: 'OFFER', count: 1 },
    ]);
  });

  it('keeps a selected value that no row has, so it can be cleared', () => {
    expect(facetOptions(ROWS, values('company'), ['Umbrella'])).toContainEqual({ value: 'Umbrella', label: 'Umbrella', count: 0 });
  });
});

describe('helpers', () => {
  it('cycles a column through ascending, descending and the default order', () => {
    expect(nextSort(null, 'company')).toEqual({ id: 'company', desc: false });
    expect(nextSort({ id: 'company', desc: false }, 'company')).toEqual({ id: 'company', desc: true });
    expect(nextSort({ id: 'company', desc: true }, 'company')).toBeNull();
    expect(nextSort({ id: 'title', desc: true }, 'company')).toEqual({ id: 'company', desc: false });
  });

  it('reports whether search or a filter is active', () => {
    expect(isFiltered(EMPTY_VIEW)).toBe(false);
    expect(isFiltered(view('sort=company'))).toBe(false);
    expect(isFiltered(view('q=a'))).toBe(true);
    expect(isFiltered(view('location='))).toBe(true);
  });

  it('formats a local day as YYYY-MM-DD', () => {
    expect(toIsoDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('labels single days, ranges and open ends', () => {
    const r = (from: string | null, to: string | null): DateRange => ({ from, to });
    const day = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' });
    expect(dateRangeLabel(r('2026-11-03', '2026-11-03'))).toBe(day('2026-11-03'));
    expect(dateRangeLabel(r('2026-11-03', '2026-11-07'))).toBe(`${day('2026-11-03')} – ${day('2026-11-07')}`);
    expect(dateRangeLabel(r('2026-11-03', null))).toBe(`From ${day('2026-11-03')}`);
    expect(dateRangeLabel(r(null, '2026-11-07'))).toBe(`Until ${day('2026-11-07')}`);
  });
});
