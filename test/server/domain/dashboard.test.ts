import { describe, expect, it } from 'vitest';
import { summarizeDashboard, type HistoryRow } from '../../../src/server/domain/dashboard.js';
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from '../../../src/server/domain/types.js';

const NOW = new Date('2026-11-09T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();

let seq = 0;
function app(overrides: Partial<Application> = {}): Application {
  seq += 1;
  return {
    id: `app-${seq}`,
    profile_id: 'p1',
    job_id: null,
    company: 'Acme',
    role: 'SRE',
    url: null,
    status: 'applied',
    applied_at: NOW.toISOString(),
    status_changed_at: NOW.toISOString(),
    notes: null,
    sender_domains: [],
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

function row(appId: string, from: ApplicationStatus | null, to: ApplicationStatus, at: string): HistoryRow {
  return { application_id: appId, from_status: from, to_status: to, changed_at: at };
}

describe('summarizeDashboard', () => {
  it('summarizes an empty profile', () => {
    const s = summarizeDashboard([], [], 0, NOW);
    expect(s.total).toBe(0);
    expect(Object.keys(s.status_counts).sort()).toEqual([...APPLICATION_STATUSES].sort());
    for (const status of APPLICATION_STATUSES) expect(s.status_counts[status]).toBe(0);
    expect(s.funnel).toEqual({ applied: 0, screening: 0, interview: 0, offer: 0 });
    expect(s.rejected_at).toEqual({ applied: 0, screening: 0, interview: 0, offer: 0 });
    expect(s.quiet).toEqual([]);
    expect(s.quiet_days).toBe(14);
  });

  it('counts each rejection at the furthest step it reached', () => {
    const afterApplying = app({ status: 'rejected' });
    const afterInterview = app({ status: 'rejected' });
    const created = app({ status: 'rejected' });
    const skipped = app({ status: 'rejected' });
    const stillInterviewing = app({ status: 'interview' });
    const history = [
      row(afterApplying.id, 'applied', 'rejected', ago(2)),
      row(afterInterview.id, 'applied', 'screening', ago(9)),
      row(afterInterview.id, 'screening', 'interview', ago(5)),
      row(afterInterview.id, 'interview', 'rejected', ago(1)),
      row(skipped.id, 'applied', 'interview', ago(4)),
      row(skipped.id, 'interview', 'rejected', ago(1)),
      row(stillInterviewing.id, 'applied', 'interview', ago(3)),
    ];
    const s = summarizeDashboard([afterApplying, afterInterview, created, skipped, stillInterviewing], history, 0, NOW);
    expect(s.rejected_at).toEqual({ applied: 2, screening: 0, interview: 2, offer: 0 });
    // Rejections stay inside the reach counts, so the funnel itself is unchanged.
    expect(s.funnel).toEqual({ applied: 5, screening: 3, interview: 3, offer: 0 });
  });

  it('counts every status', () => {
    const apps = ['saved', 'applied', 'applied', 'rejected'].map((status) =>
      app({ status: status as ApplicationStatus }),
    );
    const s = summarizeDashboard(apps, [], 0, NOW);
    expect(s.total).toBe(4);
    expect(s.status_counts).toEqual({
      saved: 1,
      applied: 2,
      screening: 0,
      interview: 0,
      offer: 0,
      rejected: 1,
      withdrawn: 0,
      no_response: 0,
    });
  });

  it('counts a skipped step as passed', () => {
    const a = app({ status: 'interview' });
    const s = summarizeDashboard([a], [row(a.id, 'applied', 'interview', ago(1))], 0, NOW);
    expect(s.funnel).toEqual({ applied: 1, screening: 1, interview: 1, offer: 0 });
  });

  it('takes the creation status from the first history row', () => {
    const a = app({ status: 'rejected' });
    const s = summarizeDashboard([a], [row(a.id, 'interview', 'rejected', ago(1))], 0, NOW);
    expect(s.funnel.interview).toBe(1);
  });

  it('counts direct rejected and no_response as applied', () => {
    const apps = [app({ status: 'rejected' }), app({ status: 'no_response' })];
    const s = summarizeDashboard(apps, [], 0, NOW);
    expect(s.funnel).toEqual({ applied: 2, screening: 0, interview: 0, offer: 0 });
  });

  it('does not count saved then withdrawn as applied', () => {
    const a = app({ status: 'withdrawn' });
    const b = app({ status: 'saved' });
    const s = summarizeDashboard([a, b], [row(a.id, 'saved', 'withdrawn', ago(1))], 0, NOW);
    expect(s.funnel.applied).toBe(0);
  });

  it('lets an offer reach every stage', () => {
    const s = summarizeDashboard([app({ status: 'offer' })], [], 0, NOW);
    expect(s.funnel).toEqual({ applied: 1, screening: 1, interview: 1, offer: 1 });
  });

  it('treats 14 days as quiet and 13.99 days as not', () => {
    const quiet = app({ applied_at: '2026-10-26T12:00:00.000Z' });
    const fresh = app({ applied_at: '2026-10-26T12:00:01.000Z' });
    const s = summarizeDashboard([quiet, fresh], [], 0, NOW);
    expect(s.quiet).toHaveLength(1);
    expect(s.quiet[0]).toMatchObject({
      id: quiet.id,
      status: 'applied',
      since: '2026-10-26T12:00:00.000Z',
      days: 14,
    });
  });

  it('counts a backdated applied date', () => {
    const a = app({ applied_at: ago(30), status_changed_at: NOW.toISOString() });
    const s = summarizeDashboard([a], [], 0, NOW);
    expect(s.quiet[0]?.days).toBe(30);
  });

  it('uses status_changed_at after a real status change', () => {
    const a = app({ applied_at: ago(3), status_changed_at: ago(20) });
    const s = summarizeDashboard([a], [row(a.id, 'saved', 'applied', ago(20))], 0, NOW);
    expect(s.quiet[0]?.days).toBe(20);
  });

  it('falls back to status_changed_at when applied_at is null', () => {
    const a = app({ applied_at: null, status_changed_at: ago(15) });
    const s = summarizeDashboard([a], [], 0, NOW);
    expect(s.quiet[0]).toMatchObject({ days: 15, since: a.status_changed_at });
  });

  it('uses status_changed_at for interview and never flags offer or no_response', () => {
    const interview = app({ status: 'interview', status_changed_at: ago(15) });
    const offer = app({ status: 'offer', status_changed_at: ago(30) });
    const silent = app({ status: 'no_response', status_changed_at: ago(30) });
    const s = summarizeDashboard([interview, offer, silent], [], 0, NOW);
    expect(s.quiet.map((q) => q.id)).toEqual([interview.id]);
    expect(s.quiet[0]).toMatchObject({ status: 'interview', days: 15 });
  });

  it('does not flag an applied date in the future', () => {
    const a = app({ applied_at: new Date(NOW.getTime() + 2 * DAY).toISOString() });
    expect(summarizeDashboard([a], [], 0, NOW).quiet).toEqual([]);
  });

  it('lists quiet applications oldest first', () => {
    const apps = [30, 15, 20].map((d) => app({ applied_at: ago(d) }));
    const s = summarizeDashboard(apps, [], 0, NOW);
    expect(s.quiet.map((q) => q.days)).toEqual([30, 20, 15]);
  });

  it('passes pending proposals through', () => {
    expect(summarizeDashboard([], [], 3, NOW).pending_proposals).toBe(3);
  });
});
