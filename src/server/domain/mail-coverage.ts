// Which date ranges a scoped sync's list call left uncovered (SOW-0051). The Gmail connector returns at most
// 50 threads per search and no page token, so a search that came back near that size may be cut off.

// 49 was seen for what may be a cut-off 50 with one filtered message, so the margin is generous.
export const CUT_OFF_THREADS = 45;

export interface DateRange {
  // Gmail's YYYY/MM/DD; '' is an open end.
  after: string;
  before: string;
}

export interface ListedWindow extends DateRange {
  thread_count: number;
}

const DAY = /^\d{4}\/\d{2}\/\d{2}$/;
// Sorts after every day, so an open end compares as "later than anything".
const OPEN_END = '￿';

const validDay = (value: string): boolean => value === '' || DAY.test(value);

// The complement of the union of the windows that are trustworthy: well formed, ending after they start,
// and under the cut-off, counted from `from` (a scheduled sync lists only recent mail, decision 14B).
// YYYY/MM/DD strings compare in date order, and '' sorts before every day.
export function uncoveredRanges(windows: ListedWindow[], from = ''): DateRange[] {
  const covered = windows
    .filter((w) => validDay(w.after) && validDay(w.before) && w.thread_count < CUT_OFF_THREADS)
    .map((w) => ({ start: w.after, end: w.before === '' ? OPEN_END : w.before }))
    .filter((w) => w.start < w.end)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const gaps: DateRange[] = [];
  let cursor = from;
  for (const w of covered) {
    if (w.start > cursor) gaps.push({ after: cursor, before: w.start });
    if (w.end > cursor) cursor = w.end;
  }
  if (cursor !== OPEN_END) gaps.push({ after: cursor, before: '' });
  return gaps;
}

export function describeRange(r: DateRange): string {
  if (r.after === '' && r.before === '') return 'all dates';
  if (r.after === '') return `before ${r.before}`;
  if (r.before === '') return `from ${r.after} on`;
  return `from ${r.after} to before ${r.before}`;
}
