import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPLICATION_COLUMNS, applicationViewKey, tileQuery } from '../../src/ui/application-view.js';
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
