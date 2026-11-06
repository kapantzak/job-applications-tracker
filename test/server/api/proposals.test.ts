import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Application, Proposal } from '../../../src/server/domain/types.js';
import { makeHarness, type Harness } from './harness.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

function seedProposal(): { app: Application; proposal: Proposal } {
  const app = h.deps.applicationsRepo.create({ profile_id: h.profile.id, company: 'Hooli', role: 'Engineer', status: 'applied' });
  const run = h.deps.runsRepo.create('sync_mail', h.profile.id, { adapter_id: 'claude', prompt_version: null });
  const [proposal] = h.deps.proposalsRepo.createMany(run.id, [
    {
      application_id: app.id,
      proposed_status: 'interview',
      confidence: 0.8,
      reason: 'invented invite',
      evidence: {
        message_id: 'msg-invented-1',
        date: '2026-10-01T00:00:00.000Z',
        from: 'talent@hooli.example',
        subject: 'Interview',
        snippet: 'Let us talk',
      },
    },
  ]);
  return { app, proposal };
}

describe('proposals', () => {
  it('GET lists pending proposals with their application embedded', async () => {
    const { app, proposal } = seedProposal();
    const res = await h.app.request(`${h.base}/proposals`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as (Proposal & { application: Application })[];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(proposal.id);
    expect(body[0].application).toEqual(app);
  });

  it('accept returns proposal and application; accepting twice is 409', async () => {
    const { proposal } = seedProposal();
    const first = await h.app.request(`${h.base}/proposals/${proposal.id}/accept`, { method: 'POST' });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { proposal: Proposal; application: Application };
    expect(body.proposal.state).toBe('accepted');
    expect(body.application.status).toBe('interview');

    const second = await h.app.request(`${h.base}/proposals/${proposal.id}/accept`, { method: 'POST' });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toMatch(/not pending/);
  });

  it('reject returns the proposal and leaves the application alone', async () => {
    const { app, proposal } = seedProposal();
    const res = await h.app.request(`${h.base}/proposals/${proposal.id}/reject`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { proposal: Proposal }).proposal.state).toBe('rejected');
    expect(h.deps.applicationsRepo.get(app.id)?.status).toBe('applied');
    const again = await h.app.request(`${h.base}/proposals/${proposal.id}/reject`, { method: 'POST' });
    expect(again.status).toBe(409);
  });

  it.each(['accept', 'reject'])('%s on an unknown proposal is 404', async (action) => {
    const res = await h.app.request(`${h.base}/proposals/nope/${action}`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
