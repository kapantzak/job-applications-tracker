import { describe, expect, it } from 'vitest';
import { formatTime } from '../../src/ui/format.js';

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
