import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DashboardSummary } from '../../../src/server/domain/dashboard.js';
import { makeHarness, SAMPLE_PROFILE, type Harness } from './harness.js';

let h: Harness;

const OTHER = { ...SAMPLE_PROFILE, name: 'Data roles', target_roles: ['Data Engineer'] };

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

describe('dashboard', () => {
  it('GET summarizes only this profile', async () => {
    const repo = h.deps.applicationsRepo;
    const acme = repo.create({ profile_id: h.profile.id, company: 'Acme', role: 'Engineer', status: 'applied' });
    repo.setStatus(acme.id, 'interview', 'user');
    repo.create({ profile_id: h.profile.id, company: 'Globex', role: 'Engineer', status: 'saved' });
    const other = h.deps.profilesRepo.create(OTHER);
    const initech = repo.create({ profile_id: other.id, company: 'Initech', role: 'Engineer', status: 'applied' });
    repo.setStatus(initech.id, 'offer', 'user');

    const run = h.deps.runsRepo.create('sync_mail', h.profile.id, { adapter_id: 'claude', prompt_version: null });
    h.deps.proposalsRepo.createMany(run.id, [
      {
        application_id: acme.id,
        proposed_status: 'offer',
        confidence: 0.8,
        reason: 'invented offer',
        evidence: {
          message_id: 'msg-invented-1',
          date: '2026-10-01T00:00:00.000Z',
          from: 'talent@acme.example',
          subject: 'Offer',
          snippet: 'Congratulations',
        },
      },
    ]);

    // The other profile has its own pending proposal; it must not leak into this response.
    const otherRun = h.deps.runsRepo.create('sync_mail', other.id, { adapter_id: 'claude', prompt_version: null });
    h.deps.proposalsRepo.createMany(otherRun.id, [
      {
        application_id: initech.id,
        proposed_status: 'rejected',
        confidence: 0.7,
        reason: 'invented rejection',
        evidence: {
          message_id: 'msg-invented-2',
          date: '2026-10-02T00:00:00.000Z',
          from: 'hr@initech.example',
          subject: 'Update',
          snippet: 'Unfortunately',
        },
      },
    ]);

    const res = await h.app.request(`${h.base}/dashboard`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardSummary;
    expect(body.total).toBe(2);
    expect(body.status_counts.interview).toBe(1);
    expect(body.status_counts.saved).toBe(1);
    expect(body.status_counts.offer).toBe(0);
    expect(body.funnel.interview).toBe(1);
    expect(body.funnel.offer).toBe(0);
    expect(body.pending_proposals).toBe(1);
    expect(body.quiet_days).toBe(14);
  });

  it('unknown profile is 404', async () => {
    const res = await h.app.request('/api/profiles/nope/dashboard');
    expect(res.status).toBe(404);
  });
});
