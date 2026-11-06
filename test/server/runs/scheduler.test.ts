import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../../../src/server/domain/types.js';
import { createSyncScheduler, type SyncScheduler } from '../../../src/server/runs/scheduler.js';

const HOUR = 3_600_000;

let interval: 'off' | '1h' | '6h' | '24h';
let calls: string[];
let scheduler: SyncScheduler;

function build(): SyncScheduler {
  return createSyncScheduler({
    settingsRepo: { getAll: () => ({ sync_interval: interval }) as never },
    queue: {
      enqueue: (kind) => {
        calls.push(kind);
        return { id: 'r1', kind } as unknown as Run;
      },
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  interval = 'off';
  calls = [];
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
    expect(calls.every((k) => k === 'sync_mail')).toBe(true);
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
