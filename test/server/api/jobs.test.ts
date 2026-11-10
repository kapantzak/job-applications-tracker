import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Application, Job, JobListItem } from '../../../src/server/domain/types.js';
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

    expect(await ids(`${h.base}/jobs`)).toEqual([live.id]);
    expect(await ids(`${h.base}/jobs?includeDead=1`)).toEqual([live.id, dead.id].sort());
    expect(await ids(`${h.base}/jobs?includeDismissed=true`)).toEqual([live.id, dismissed.id].sort());
    expect(await ids(`${h.base}/jobs?includeDead=0&includeDismissed=false`)).toEqual([live.id]);
  });

  it('GET reports when each job was last seen and the search that first found it', async () => {
    const job = insertJob(h);
    const run = h.deps.runsRepo.get(job.run_id)!;

    const [item] = (await (await h.app.request(`${h.base}/jobs`)).json()) as JobListItem[];

    expect(item).toMatchObject({
      id: job.id,
      run_id: run.id,
      last_seen_run_id: run.id,
      last_seen_at: job.created_at,
      run_started_at: run.started_at,
      run_effort_mode: 'default',
    });
  });

  it('GET reports the latest application status per job', async () => {
    const applied = insertJob(h);
    const untouched = insertJob(h);
    await h.app.request(`${h.base}/jobs/${applied.id}/applied`, { method: 'POST' });

    const list = (await (await h.app.request(`${h.base}/jobs`)).json()) as (Job & { application_status: string | null })[];
    const byId = Object.fromEntries(list.map((j) => [j.id, j.application_status]));
    expect(byId).toEqual({ [applied.id]: 'applied', [untouched.id]: null });

    const app = h.deps.applicationsRepo.findByJobId(applied.id) as Application;
    h.deps.applicationsRepo.setStatus(app.id, 'interview', 'user');
    const again = (await (await h.app.request(`${h.base}/jobs`)).json()) as (Job & { application_status: string | null })[];
    expect(again.find((j) => j.id === applied.id)?.application_status).toBe('interview');
  });

  it('POST applied creates an applied application with inferred sender domains', async () => {
    const job = insertJob(h);
    const res = await h.app.request(`${h.base}/jobs/${job.id}/applied`, { method: 'POST' });
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
    const res = await h.app.request(`${h.base}/jobs/${job.id}/applied`, { method: 'POST' });
    expect(((await res.json()) as Application).sender_domains).toEqual([]);
  });

  it('POST save creates a saved application', async () => {
    const job = insertJob(h);
    const res = await h.app.request(`${h.base}/jobs/${job.id}/save`, { method: 'POST' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ job_id: job.id, status: 'saved', applied_at: null });
  });

  it('POST save twice returns the same application and creates no duplicate', async () => {
    const job = insertJob(h);
    const first = await h.app.request(`${h.base}/jobs/${job.id}/save`, { method: 'POST' });
    const second = await h.app.request(`${h.base}/jobs/${job.id}/save`, { method: 'POST' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as Application).id).toBe(((await first.json()) as Application).id);
    expect(h.deps.applicationsRepo.list(h.profile.id)).toHaveLength(1);
  });

  it('POST applied after save advances the same application to applied', async () => {
    const job = insertJob(h);
    const saved = (await (await h.app.request(`${h.base}/jobs/${job.id}/save`, { method: 'POST' })).json()) as Application;
    const res = await h.app.request(`${h.base}/jobs/${job.id}/applied`, { method: 'POST' });
    expect(res.status).toBe(200);
    const app = (await res.json()) as Application;
    expect(app).toMatchObject({ id: saved.id, status: 'applied' });
    expect(app.applied_at).not.toBeNull();
    expect(h.deps.applicationsRepo.list(h.profile.id)).toHaveLength(1);
    expect(h.deps.applicationsRepo.history(saved.id)).toMatchObject([
      { from_status: 'saved', to_status: 'applied', source: 'user' },
    ]);
  });

  it('POST applied twice returns the existing application unchanged', async () => {
    const job = insertJob(h);
    const first = (await (await h.app.request(`${h.base}/jobs/${job.id}/applied`, { method: 'POST' })).json()) as Application;
    const res = await h.app.request(`${h.base}/jobs/${job.id}/applied`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(first);
    expect(h.deps.applicationsRepo.list(h.profile.id)).toHaveLength(1);
  });

  it('POST save and applied leave an application in a later status unchanged', async () => {
    const job = insertJob(h);
    const existing = h.deps.applicationsRepo.create({ profile_id: h.profile.id,
      job_id: job.id,
      company: 'Globex',
      role: 'Backend Engineer',
      status: 'interview',
    });
    for (const action of ['save', 'applied']) {
      const res = await h.app.request(`${h.base}/jobs/${job.id}/${action}`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(existing);
    }
    expect(h.deps.applicationsRepo.list(h.profile.id)).toHaveLength(1);
  });

  it('POST dismiss is 204 and hides the job', async () => {
    const job = insertJob(h);
    const res = await h.app.request(`${h.base}/jobs/${job.id}/dismiss`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(h.deps.jobsRepo.get(job.id)?.dismissed_at).not.toBeNull();
  });

  it.each(['applied', 'save', 'dismiss'])('POST %s on an unknown job is 404', async (action) => {
    const res = await h.app.request(`${h.base}/jobs/no-such-job/${action}`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Job not found' });
    expect(h.deps.applicationsRepo.list(h.profile.id)).toEqual([]);
  });
});
