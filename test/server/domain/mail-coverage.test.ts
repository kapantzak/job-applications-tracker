import { describe, expect, it } from 'vitest';
import { CUT_OFF_THREADS, describeRange, uncoveredRanges } from '../../../src/server/domain/mail-coverage.js';

const w = (after: string, before: string, thread_count = 10) => ({ after, before, thread_count });

describe('uncoveredRanges', () => {
  it('is empty when the windows cover all time without gaps', () => {
    expect(uncoveredRanges([w('', '2026/10/01'), w('2026/10/01', '2026/11/01'), w('2026/11/01', '')])).toEqual([]);
  });

  it('accepts one open window and windows in any order', () => {
    expect(uncoveredRanges([w('', '')])).toEqual([]);
    expect(uncoveredRanges([w('2026/11/01', ''), w('', '2026/11/01')])).toEqual([]);
  });

  it('asks for everything when there is no window', () => {
    expect(uncoveredRanges([])).toEqual([{ after: '', before: '' }]);
  });

  it('treats a window at the cut-off as uncovered', () => {
    expect(CUT_OFF_THREADS).toBe(45);
    expect(uncoveredRanges([w('', '2026/10/01'), w('2026/10/01', '2026/11/01', 45), w('2026/11/01', '', 44)])).toEqual([
      { after: '2026/10/01', before: '2026/11/01' },
    ]);
  });

  it('finds gaps between windows and at either open end', () => {
    expect(uncoveredRanges([w('2026/01/01', '2026/02/01'), w('2026/03/01', '2026/04/01')])).toEqual([
      { after: '', before: '2026/01/01' },
      { after: '2026/02/01', before: '2026/03/01' },
      { after: '2026/04/01', before: '' },
    ]);
  });

  it('lets overlapping windows cover each other', () => {
    expect(uncoveredRanges([w('', '2026/10/15'), w('2026/10/01', '2026/11/01'), w('2026/10/20', '')])).toEqual([]);
  });

  it('ignores windows with a malformed date or an end not after the start', () => {
    expect(uncoveredRanges([w('', '2026-10-01'), w('2026/10/01', '')])).toEqual([{ after: '', before: '2026/10/01' }]);
    expect(uncoveredRanges([w('', '2026/10/01'), w('2026/11/01', '2026/10/01'), w('2026/10/01', '')])).toEqual([]);
    expect(uncoveredRanges([w('', '2026/10/01'), w('2026/10/01', '2026/10/01'), w('2026/11/01', '')])).toEqual([
      { after: '2026/10/01', before: '2026/11/01' },
    ]);
  });
});

describe('uncoveredRanges from a start day (decision 14B)', () => {
  it('ignores dates before the start and finds gaps after it', () => {
    expect(uncoveredRanges([w('2026/11/19', '')], '2026/11/19')).toEqual([]);
    expect(uncoveredRanges([w('2026/11/01', '2026/11/20'), w('2026/11/20', '')], '2026/11/19')).toEqual([]);
    expect(uncoveredRanges([], '2026/11/19')).toEqual([{ after: '2026/11/19', before: '' }]);
    expect(uncoveredRanges([w('2026/11/20', '')], '2026/11/19')).toEqual([{ after: '2026/11/19', before: '2026/11/20' }]);
    expect(uncoveredRanges([w('', '2026/11/10')], '2026/11/19')).toEqual([{ after: '2026/11/19', before: '' }]);
  });
});

describe('describeRange', () => {
  it('names open ends in words', () => {
    expect(describeRange({ after: '', before: '' })).toBe('all dates');
    expect(describeRange({ after: '', before: '2026/10/01' })).toBe('before 2026/10/01');
    expect(describeRange({ after: '2026/10/01', before: '' })).toBe('from 2026/10/01 on');
    expect(describeRange({ after: '2026/10/01', before: '2026/11/01' })).toBe('from 2026/10/01 to before 2026/11/01');
  });
});
