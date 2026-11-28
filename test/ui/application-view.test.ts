import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application } from '../../src/server/domain/types.js';
import {
  APPLICATION_COLUMNS,
  applicationRows,
  applicationViewKey,
  branchQuery,
  tileQuery,
} from '../../src/ui/application-view.js';
import { applyView } from '../../src/ui/table-view.js';
import { EMPTY_VIEW, hasView, parseView, viewQuery } from '../../src/ui/table-view.js';
import { isOneTimeView, ONE_TIME_VIEW, readStoredView, storeView } from '../../src/ui/view-storage.js';

const KEY = applicationViewKey('pf1');
const view = (query: string) => parseView(new URLSearchParams(query), APPLICATION_COLUMNS);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('viewQuery and hasView', () => {
  it('writes only the view, in canonical form', () => {
    expect(viewQuery(view('status=offer&q=+&sort=role&other=1'), APPLICATION_COLUMNS).toString()).toBe('sort=role&status=offer');
    expect(viewQuery(EMPTY_VIEW, APPLICATION_COLUMNS).toString()).toBe('');
  });

  it('counts search, sort or a filter as a view, but not blank or unknown parameters', () => {
    expect(hasView(new URLSearchParams('q=acme'), APPLICATION_COLUMNS)).toBe(true);
    expect(hasView(new URLSearchParams('sort=-applied'), APPLICATION_COLUMNS)).toBe(true);
    expect(hasView(new URLSearchParams('status='), APPLICATION_COLUMNS)).toBe(true);
    expect(hasView(new URLSearchParams('q=+&role=&other=1&sort=nope'), APPLICATION_COLUMNS)).toBe(false);
  });
});

describe('readStoredView and storeView', () => {
  it('stores the canonical query and removes the key for an empty view', () => {
    storeView(KEY, view('company=Acme&q=sre'), APPLICATION_COLUMNS);
    expect(localStorage.getItem(KEY)).toBe('q=sre&company=Acme');
    storeView(KEY, EMPTY_VIEW, APPLICATION_COLUMNS);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reads back only what is still a view of the table', () => {
    localStorage.setItem(KEY, 'company=Acme&bogus=1&applied=2026-02-30..&sort=-applied');
    expect(readStoredView(KEY, APPLICATION_COLUMNS).toString()).toBe('sort=-applied&company=Acme');
    expect(readStoredView(applicationViewKey('pf2'), APPLICATION_COLUMNS).toString()).toBe('');
  });

  it('gives an empty view and stores nothing when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredView(KEY, APPLICATION_COLUMNS).toString()).toBe('');
    expect(() => storeView(KEY, view('company=Acme'), APPLICATION_COLUMNS)).not.toThrow();
  });
});

describe('isOneTimeView', () => {
  it('accepts only the one-time marker', () => {
    expect(isOneTimeView(ONE_TIME_VIEW)).toBe(true);
    expect(isOneTimeView({ oneTimeView: 'true' })).toBe(false);
    expect(isOneTimeView(null)).toBe(false);
    expect(isOneTimeView(undefined)).toBe(false);
  });
});

describe('tileQuery', () => {
  it('keeps the other filters and the sort and sets the tile statuses', () => {
    expect(tileQuery(view('company=Acme&sort=role'), ['interview'])).toBe('sort=role&company=Acme&status=interview');
    expect(tileQuery(EMPTY_VIEW, ['applied', 'screening', 'interview'])).toBe(
      'status=applied&status=screening&status=interview',
    );
  });

  it('narrows to the statuses the status filter keeps, or gives null when it keeps none', () => {
    const chosen = view('status=screening&status=rejected&status=interview');
    expect(tileQuery(chosen, ['applied', 'screening', 'interview'])).toBe('status=screening&status=interview');
    expect(tileQuery(chosen, ['offer'])).toBeNull();
  });
});

describe('Furthest step (SOW-0057)', () => {
  const base = { company: 'Acme', role: 'SRE', applied_at: null } as const;
  const apps = [
    { ...base, id: 'a1', status: 'rejected' },
    { ...base, id: 'a2', status: 'rejected' },
    { ...base, id: 'a3', status: 'saved' },
  ] as unknown as Application[];
  const history = [
    { application_id: 'a1', from_status: 'applied', to_status: 'interview', changed_at: '2026-11-01T09:00:00Z' },
    { application_id: 'a1', from_status: 'interview', to_status: 'rejected', changed_at: '2026-11-02T09:00:00Z' },
  ] as const;
  const rows = applicationRows(apps, [...history]);

  it('gives each row the furthest step it reached, or null when never sent', () => {
    expect(rows.map((r) => r.reached)).toEqual(['interview', 'applied', null]);
  });

  it('filters by furthest step, with an empty value for not sent', () => {
    const ids = (query: string) => applyView(rows, APPLICATION_COLUMNS, view(query)).map((r) => r.id);
    expect(ids('reached=interview&status=rejected')).toEqual(['a1']);
    expect(ids('reached=applied')).toEqual(['a2']);
    expect(ids('reached=')).toEqual(['a3']);
    expect(viewQuery(view('reached=interview&other=1'), APPLICATION_COLUMNS).toString()).toBe('reached=interview');
  });
});

describe('branchQuery', () => {
  it('keeps the other filters and the sort and sets the branch statuses and step', () => {
    expect(branchQuery(view('company=Acme&sort=role'), 'interview', ['rejected'])).toBe(
      'sort=role&company=Acme&status=rejected&reached=interview',
    );
  });

  it('narrows to what the status and Furthest step filters keep, or gives null when they keep none', () => {
    const chosen = view('status=applied&status=interview&reached=screening&reached=interview');
    expect(branchQuery(chosen, 'interview', ['saved', 'applied', 'screening', 'interview', 'offer'])).toBe(
      'status=applied&status=interview&reached=interview',
    );
    expect(branchQuery(chosen, 'interview', ['rejected'])).toBeNull();
    expect(branchQuery(chosen, 'applied', ['applied'])).toBeNull();
  });
});
