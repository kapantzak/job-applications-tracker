import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Application, StatusHistoryEntry } from '../../../src/server/domain/types.js';
import { json, makeHarness, type Harness } from './harness.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

function seed(status: Application['status'] = 'applied'): Application {
  return h.deps.applicationsRepo.create({ company: 'Initrode', role: 'SRE', status });
}

describe('applications', () => {
  it('GET lists all, or only open ones with open=1', async () => {
    const open = seed('applied');
    const closed = seed('rejected');
    const all = (await (await h.app.request('/api/applications')).json()) as Application[];
    expect(all.map((a) => a.id).sort()).toEqual([open.id, closed.id].sort());
    const onlyOpen = (await (await h.app.request('/api/applications?open=1')).json()) as Application[];
    expect(onlyOpen.map((a) => a.id)).toEqual([open.id]);
  });

  it('POST creates a manual application (201) and validates the body', async () => {
    const res = await h.app.request(
      '/api/applications',
      json('POST', { company: 'Vandelay', role: 'Importer', url: 'https://vandelay.example/jobs/1', notes: 'n' }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ company: 'Vandelay', status: 'applied', job_id: null });

    const missing = await h.app.request('/api/applications', json('POST', { company: 'Vandelay' }));
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toMatch(/^role: /);

    const bogus = await h.app.request(
      '/api/applications',
      json('POST', { company: 'V', role: 'R', status: 'bogus' }),
    );
    expect(bogus.status).toBe(400);
  });

  it('GET by id includes the status history; unknown id is 404', async () => {
    const app = seed('applied');
    h.deps.applicationsRepo.setStatus(app.id, 'screening', 'user');
    const res = await h.app.request(`/api/applications/${app.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Application & { history: StatusHistoryEntry[] };
    expect(body.status).toBe('screening');
    expect(body.history.map((e) => [e.from_status, e.to_status])).toEqual([['applied', 'screening']]);

    const missing = await h.app.request('/api/applications/nope');
    expect(missing.status).toBe(404);
  });

  it('PATCH updates allowed fields and rejects unknown keys', async () => {
    const app = seed();
    const res = await h.app.request(
      `/api/applications/${app.id}`,
      json('PATCH', { notes: 'called back', sender_domains: ['initrode.example'] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ notes: 'called back', sender_domains: ['initrode.example'] });

    const status = await h.app.request(`/api/applications/${app.id}`, json('PATCH', { status: 'offer' }));
    expect(status.status).toBe(400);
    expect(h.deps.applicationsRepo.get(app.id)?.status).toBe('applied');

    const missing = await h.app.request('/api/applications/nope', json('PATCH', { notes: 'x' }));
    expect(missing.status).toBe(404);
  });

  it('POST status with a bogus status is 400', async () => {
    const app = seed();
    const res = await h.app.request(`/api/applications/${app.id}/status`, json('POST', { status: 'bogus' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/^status: /);
    expect(h.deps.applicationsRepo.get(app.id)?.status).toBe('applied');
  });

  it('POST status records a user history entry; unknown id is 404', async () => {
    const app = seed();
    const res = await h.app.request(`/api/applications/${app.id}/status`, json('POST', { status: 'interview' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Application).status).toBe('interview');
    expect(h.deps.applicationsRepo.history(app.id).map((e) => e.source)).toEqual(['user']);

    const missing = await h.app.request('/api/applications/nope/status', json('POST', { status: 'interview' }));
    expect(missing.status).toBe(404);
  });
});
