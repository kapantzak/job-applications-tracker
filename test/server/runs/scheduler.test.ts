import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../../../src/server/domain/types.js';
import { createSyncScheduler, type SyncScheduler } from '../../../src/server/runs/scheduler.js';

const HOUR = 3_600_000;

let interval: 'off' | '1h' | '6h' | '24h';
let calls: string[];
let profileIds: string[];
let listProfiles: () => string[];
let scheduler: SyncScheduler;

function build(): SyncScheduler {
  return createSyncScheduler({
    settingsRepo: { getAll: () => ({ sync_interval: interval }) as never },
    queue: {
      enqueue: (kind, profileId) => {
        if (profileId === 'p-broken') throw new Error('enqueue failed');
        calls.push(`${kind}:${profileId}`);
        return { id: 'r1', kind } as unknown as Run;
      },
    },
    syncProfileIds: () => listProfiles(),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  interval = 'off';
  calls = [];
  profileIds = ['p1'];
  listProfiles = () => profileIds;
  scheduler = build();
});

afterEach(() => {
  scheduler.stop();
  vi.useRealTimers();
});

describe('sync scheduler', () => {
  it('never enqueues when interval is off', () => {
    scheduler.start();
    vi.advanceTimersByTime(24 * HOUR);
    expect(calls).toEqual([]);
  });

  it('enqueues sync_mail on every 1h tick', () => {
    interval = '1h';
    scheduler.start();
    vi.advanceTimersByTime(HOUR);
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(2 * HOUR);
    expect(calls).toHaveLength(3);
    expect(calls.every((k) => k === 'sync_mail:p1')).toBe(true);
  });

  it('enqueues one sync per listed profile on each tick, read fresh every time', () => {
    interval = '1h';
    profileIds = ['p1', 'p2'];
    scheduler.start();
    vi.advanceTimersByTime(HOUR);
    expect(calls).toEqual(['sync_mail:p1', 'sync_mail:p2']);
    profileIds = [];
    vi.advanceTimersByTime(HOUR);
    expect(calls).toHaveLength(2);
  });

  it('a failing enqueue for one profile does not skip the others', () => {
    interval = '1h';
    profileIds = ['p-broken', 'p2'];
    scheduler.start();
    vi.advanceTimersByTime(HOUR);
    expect(calls).toEqual(['sync_mail:p2']);
  });

  it('keeps the timer alive when listing profiles fails', () => {
    interval = '1h';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    listProfiles = () => {
      throw new Error('db closed');
    };
    scheduler.start();
    vi.advanceTimersByTime(HOUR);
    expect(calls).toEqual([]);
    expect(error).toHaveBeenCalledWith('sync scheduler: could not list profiles: db closed');
    listProfiles = () => ['p1'];
    vi.advanceTimersByTime(HOUR);
    expect(calls).toEqual(['sync_mail:p1']);
    error.mockRestore();
  });

  it('honours 6h and 24h intervals', () => {
    interval = '6h';
    scheduler.start();
    vi.advanceTimersByTime(5 * HOUR);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(HOUR);
    expect(calls).toHaveLength(1);
    scheduler.stop();

    scheduler = build();
    calls = [];
    interval = '24h';
    scheduler.start();
    vi.advanceTimersByTime(23 * HOUR);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(HOUR);
    expect(calls).toHaveLength(1);
  });

  it('start twice does not double the timer', () => {
    interval = '1h';
    scheduler.start();
    scheduler.start();
    vi.advanceTimersByTime(HOUR);
    expect(calls).toHaveLength(1);
  });

  it('refresh to off stops further enqueues', () => {
    interval = '1h';
    scheduler.start();
    vi.advanceTimersByTime(HOUR);
    interval = 'off';
    scheduler.refresh();
    vi.advanceTimersByTime(5 * HOUR);
    expect(calls).toHaveLength(1);
  });

  it('refresh applies a new interval', () => {
    scheduler.start();
    interval = '1h';
    scheduler.refresh();
    vi.advanceTimersByTime(HOUR);
    expect(calls).toHaveLength(1);
  });

  it('stop clears the timer and refresh after stop does nothing', () => {
    interval = '1h';
    scheduler.start();
    scheduler.stop();
    vi.advanceTimersByTime(3 * HOUR);
    expect(calls).toHaveLength(0);
    scheduler.refresh();
    vi.advanceTimersByTime(3 * HOUR);
    expect(calls).toHaveLength(0);
  });
});
