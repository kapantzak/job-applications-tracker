import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Application, Job } from '../../../src/server/domain/types.js';
import { insertJob, makeHarness, type Harness } from './harness.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

describe('jobs', () => {
  it('GET hides dead and dismissed jobs unless asked', async () => {
    const live = insertJob(h);
    const dead = insertJob(h, { verification_status: 'dead' });
    const dismissed = insertJob(h);
    h.deps.jobsRepo.dismiss(dismissed.id);

    const ids = async (path: string) =>
      ((await (await h.app.request(path)).json()) as Job[]).map((j) => j.id).sort();

    expect(await ids('/api/jobs')).toEqual([live.id]);
    expect(await ids('/api/jobs?includeDead=1')).toEqual([live.id, dead.id].sort());
    expect(await ids('/api/jobs?includeDismissed=true')).toEqual([live.id, dismissed.id].sort());
    expect(await ids('/api/jobs?includeDead=0&includeDismissed=false')).toEqual([live.id]);
  });

  it('POST applied creates an applied application with inferred sender domains', async () => {
    const job = insertJob(h);
    const res = await h.app.request(`/api/jobs/${job.id}/applied`, { method: 'POST' });
    expect(res.status).toBe(201);
    const app = (await res.json()) as Application;
    expect(app).toMatchObject({
      job_id: job.id,
      company: 'Globex',
      role: 'Backend Engineer',
      url: 'https://careers.globex.example/jobs/42',
      status: 'applied',
      sender_domains: ['careers.globex.example'],
    });
    expect(app.applied_at).not.toBeNull();
    expect(h.deps.applicationsRepo.get(app.id)).toEqual(app);
  });

  it('POST applied leaves sender domains empty for ATS hosts', async () => {
    const job = insertJob(h, { canonical_url: 'https://boards.greenhouse.io/globex/jobs/1' });
    const res = await h.app.request(`/api/jobs/${job.id}/applied`, { method: 'POST' });
    expect(((await res.json()) as Application).sender_domains).toEqual([]);
  });

  it('POST save creates a saved application', async () => {
    const job = insertJob(h);
    const res = await h.app.request(`/api/jobs/${job.id}/save`, { method: 'POST' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ job_id: job.id, status: 'saved', applied_at: null });
  });

  it('POST dismiss is 204 and hides the job', async () => {
    const job = insertJob(h);
    const res = await h.app.request(`/api/jobs/${job.id}/dismiss`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(h.deps.jobsRepo.get(job.id)?.dismissed_at).not.toBeNull();
  });

  it.each(['applied', 'save', 'dismiss'])('POST %s on an unknown job is 404', async (action) => {
    const res = await h.app.request(`/api/jobs/no-such-job/${action}`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Job not found' });
    expect(h.deps.applicationsRepo.list()).toEqual([]);
  });
});
