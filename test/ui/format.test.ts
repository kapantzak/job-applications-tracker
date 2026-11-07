import { describe, expect, it } from 'vitest';
import { formatTime, formatUsage } from '../../src/ui/format.js';

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
