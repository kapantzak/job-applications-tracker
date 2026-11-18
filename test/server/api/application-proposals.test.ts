import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NewApplicationProposal } from '../../../src/server/db/application-proposals-repo.js';
import type { Application, ApplicationProposal } from '../../../src/server/domain/types.js';
import { json, makeHarness, SAMPLE_PROFILE, type Harness } from './harness.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

const item = (company: string): NewApplicationProposal => ({
  company,
  role: 'Engineer',
  status: 'applied',
  applied_at: '2026-10-01T00:00:00.000Z',
  job_id: null,
  url: null,
  sender_domains: [],
  confidence: 0.8,
  reason: 'invented confirmation',
  evidence: {
    message_id: `msg-${company}`,
    date: '2026-10-01T00:00:00.000Z',
    from: 'no-reply@ats.example.com',
    subject: 'Thanks for applying',
    snippet: 'We received it',
  },
});

function seed(companies: string[], profileId = h.profile.id): ApplicationProposal[] {
  const run = h.deps.runsRepo.create('sync_mail', profileId, { adapter_id: 'claude', prompt_version: null });
  return h.deps.applicationProposalsRepo.createMany(run.id, profileId, companies.map(item));
}

const post = { method: 'POST' };

describe('application proposals', () => {
  it('GET lists the pending ones of the profile only', async () => {
    const [mine] = seed(['Acme']);
    const other = h.deps.profilesRepo.create({ ...SAMPLE_PROFILE, name: 'Other profile' });
    seed(['Hooli'], other.id);

    const res = await h.app.request(`${h.base}/application-proposals`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ApplicationProposal[]).map((p) => p.id)).toEqual([mine!.id]);
  });

  it('accept creates the application and answers with both', async () => {
    const [p] = seed(['Acme']);
    const res = await h.app.request(`${h.base}/application-proposals/${p!.id}/accept`, post);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { proposal: ApplicationProposal; application: Application; outcome: string };
    expect(body.proposal.state).toBe('accepted');
    expect(body.outcome).toBe('created');
    expect(body.application).toMatchObject({ company: 'Acme', role: 'Engineer', status: 'applied' });
    expect(h.deps.applicationsRepo.list(h.profile.id).map((a) => a.id)).toEqual([body.application.id]);
  });

  it('reject records the decision', async () => {
    const [p] = seed(['Acme']);
    const res = await h.app.request(`${h.base}/application-proposals/${p!.id}/reject`, post);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { proposal: ApplicationProposal }).proposal.state).toBe('rejected');
    expect(h.deps.applicationsRepo.list(h.profile.id)).toEqual([]);
  });

  it('a decided proposal is 409', async () => {
    const [p] = seed(['Acme']);
    await h.app.request(`${h.base}/application-proposals/${p!.id}/reject`, post);
    const res = await h.app.request(`${h.base}/application-proposals/${p!.id}/accept`, post);
    expect(res.status).toBe(409);
  });

  it.each(['accept', 'reject'])("%s of an unknown id or another profile's proposal is 404", async (action) => {
    const other = h.deps.profilesRepo.create({ ...SAMPLE_PROFILE, name: 'Other profile' });
    const [theirs] = seed(['Hooli'], other.id);
    for (const id of ['missing', theirs!.id]) {
      const res = await h.app.request(`${h.base}/application-proposals/${id}/${action}`, post);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Application proposal not found' });
    }
    expect(h.deps.applicationProposalsRepo.get(theirs!.id)?.state).toBe('pending');
  });

  it('accept-all accepts only the ids the page showed and reports the count (decision 15A)', async () => {
    const [acme, globex, late] = seed(['Acme', 'Globex', 'Late']);
    const res = await h.app.request(`${h.base}/application-proposals/accept-all`, json('POST', { ids: [acme!.id, globex!.id] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 2, created: 2, moved: 0, already_tracked: 0 });
    expect(h.deps.applicationsRepo.list(h.profile.id)).toHaveLength(2);
    expect(h.deps.applicationProposalsRepo.listPending(h.profile.id).map((p) => p.id)).toEqual([late!.id]);
  });

  it("accept-all refuses another profile's id and accepts nothing", async () => {
    const [mine] = seed(['Acme']);
    const other = h.deps.profilesRepo.create({ ...SAMPLE_PROFILE, name: 'Other profile' });
    const [theirs] = seed(['Hooli'], other.id);
    const res = await h.app.request(`${h.base}/application-proposals/accept-all`, json('POST', { ids: [mine!.id, theirs!.id] }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Application proposal not found' });
    expect(h.deps.applicationProposalsRepo.listPending(h.profile.id)).toHaveLength(1);
    expect(h.deps.applicationProposalsRepo.listPending(other.id)).toHaveLength(1);
  });

  it.each([
    [{}, 400],
    [{ ids: [] }, 400],
    [{ ids: ['a'], extra: 1 }, 400],
  ])('accept-all with body %j is %i', async (body, status) => {
    seed(['Acme']);
    const res = await h.app.request(`${h.base}/application-proposals/accept-all`, json('POST', body));
    expect(res.status).toBe(status);
    expect(h.deps.applicationsRepo.list(h.profile.id)).toEqual([]);
  });

  it('accept-all without a JSON body is 415', async () => {
    seed(['Acme']);
    const res = await h.app.request(`${h.base}/application-proposals/accept-all`, post);
    expect(res.status).toBe(415);
  });

  it('the dashboard counts pending new applications', async () => {
    seed(['Acme', 'Globex']);
    const res = await h.app.request(`${h.base}/dashboard`);
    expect(((await res.json()) as { pending_new_applications: number }).pending_new_applications).toBe(2);
  });
});
