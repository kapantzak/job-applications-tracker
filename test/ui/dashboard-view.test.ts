import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseView,
  DASHBOARD_VIEW_STORAGE_KEY,
  JOURNEY_MIN_SENT,
  JOURNEY_MIN_WIDTH,
  readStoredView,
  storeView,
} from '../../src/ui/dashboard-view.js';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chooseView', () => {
  it('opens Journey from 10 sent applications and Breakdown below', () => {
    expect(JOURNEY_MIN_SENT).toBe(10);
    expect(chooseView(null, 10, false)).toBe('journey');
    expect(chooseView(null, 200, false)).toBe('journey');
    expect(chooseView(null, 9, false)).toBe('breakdown');
    expect(chooseView(null, 0, false)).toBe('breakdown');
  });

  it('lets a stored choice win over the count', () => {
    expect(chooseView('breakdown', 200, false)).toBe('breakdown');
    expect(chooseView('journey', 1, false)).toBe('journey');
  });

  it('always uses Breakdown on a narrow window', () => {
    expect(JOURNEY_MIN_WIDTH).toBe(1280);
    expect(chooseView(null, 200, true)).toBe('breakdown');
    expect(chooseView('journey', 200, true)).toBe('breakdown');
  });
});

describe('stored dashboard view', () => {
  it('reads nothing when nothing or something invalid is stored', () => {
    expect(readStoredView()).toBeNull();
    localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, 'sankey');
    expect(readStoredView()).toBeNull();
  });

  it('stores and reads back a choice', () => {
    expect(DASHBOARD_VIEW_STORAGE_KEY).toBe('dashboard-view');
    storeView('journey');
    expect(localStorage.getItem('dashboard-view')).toBe('journey');
    expect(readStoredView()).toBe('journey');
    storeView('breakdown');
    expect(readStoredView()).toBe('breakdown');
  });

  it('falls back to no choice when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => storeView('journey')).not.toThrow();
    expect(readStoredView()).toBeNull();
  });
});
