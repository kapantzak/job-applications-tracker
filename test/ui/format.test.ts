import { afterEach, describe, expect, it } from 'vitest';
import { dayToIso, formatTime, formatUsage, isoToDay } from '../../src/ui/format.js';

describe('formatTime', () => {
  it('returns a dash for a missing value', () => {
    expect(formatTime(null)).toBe('–');
  });

  it('formats a parseable date in the local format', () => {
    const iso = '2026-11-01T10:00:00.000Z';
    expect(formatTime(iso)).toBe(new Date(iso).toLocaleString());
  });

  it('returns the raw string when it is not a date', () => {
    expect(formatTime('not a date')).toBe('not a date');
  });
});

describe('formatUsage', () => {
  const none = { usage_cost_usd: null, usage_input_tokens: null, usage_output_tokens: null };

  it('is null when the agent reported nothing', () => {
    expect(formatUsage(none)).toBeNull();
  });

  it('shows the estimated cost and compact token counts', () => {
    expect(formatUsage({ usage_cost_usd: 1.234, usage_input_tokens: 1_250_000, usage_output_tokens: 3_400 })).toBe(
      '$1.23 estimated · 1.3M tokens in, 3.4k out',
    );
  });

  it('shows tokens only when no cost was reported, with ? for a missing count', () => {
    expect(formatUsage({ ...none, usage_input_tokens: 900 })).toBe('900 tokens in, ? out');
  });

  it('picks the unit after rounding, so counts just under a unit read as the next one', () => {
    expect(formatUsage({ ...none, usage_input_tokens: 999_960, usage_output_tokens: 999 })).toBe('1.0M tokens in, 999 out');
    expect(formatUsage({ ...none, usage_input_tokens: 999_949, usage_output_tokens: 1_000 })).toBe(
      '999.9k tokens in, 1.0k out',
    );
  });

  it('shows a cost under one cent as less than one cent, and zero as $0.00', () => {
    expect(formatUsage({ ...none, usage_cost_usd: 0.0014 })).toBe('<$0.01 estimated');
    expect(formatUsage({ ...none, usage_cost_usd: 0.0049 })).toBe('<$0.01 estimated');
    expect(formatUsage({ ...none, usage_cost_usd: 0.012 })).toBe('$0.01 estimated');
    expect(formatUsage({ ...none, usage_cost_usd: 0 })).toBe('$0.00 estimated');
  });
});

// Node re-reads TZ when it is assigned, so one file can check a zone on each side of UTC (SOW-0030).
describe('typed Applied dates', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('stores a typed day as local midnight west of UTC and reads the same day back', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(dayToIso('2026-11-05')).toBe('2026-11-05T08:00:00.000Z');
    expect(isoToDay(dayToIso('2026-11-05'))).toBe('2026-11-05');
    // An older row pinned to UTC midnight shows the local day the table shows.
    expect(isoToDay('2026-11-05T00:00:00.000Z')).toBe('2026-11-04');
  });

  it('stores a typed day as local midnight east of UTC and reads the same day back', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(dayToIso('2026-11-05')).toBe('2026-11-04T15:00:00.000Z');
    expect(isoToDay(dayToIso('2026-11-05'))).toBe('2026-11-05');
    expect(isoToDay('2026-11-05T20:00:00.000Z')).toBe('2026-11-06');
  });

  it('shows nothing for no date and the first ten characters of an unparseable one', () => {
    expect(isoToDay(null)).toBe('');
    expect(isoToDay('2026-13-99 or so')).toBe('2026-13-99');
  });
});
