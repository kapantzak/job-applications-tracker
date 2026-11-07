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
  return h.deps.applicationsRepo.create({ profile_id: h.profile.id, company: 'Initrode', role: 'SRE', status });
}

describe('applications', () => {
  it('GET lists all, or only open ones with open=1', async () => {
    const open = seed('applied');
    const closed = seed('rejected');
    const all = (await (await h.app.request(`${h.base}/applications`)).json()) as Application[];
    expect(all.map((a) => a.id).sort()).toEqual([open.id, closed.id].sort());
    const onlyOpen = (await (await h.app.request(`${h.base}/applications?open=1`)).json()) as Application[];
    expect(onlyOpen.map((a) => a.id)).toEqual([open.id]);
  });

  it('POST creates a manual application (201) and validates the body', async () => {
    const res = await h.app.request(
      `${h.base}/applications`,
      json('POST', { company: 'Vandelay', role: 'Importer', url: 'https://vandelay.example/jobs/1', notes: 'n' }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ company: 'Vandelay', status: 'applied', job_id: null });

    const missing = await h.app.request(`${h.base}/applications`, json('POST', { company: 'Vandelay' }));
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toMatch(/^role: /);

    const bogus = await h.app.request(
      `${h.base}/applications`,
      json('POST', { company: 'V', role: 'R', status: 'bogus' }),
    );
    expect(bogus.status).toBe(400);
  });

  it('POST infers sender_domains from the url unless the body supplies them', async () => {
    const post = async (body: object) =>
      (await (await h.app.request(`${h.base}/applications`, json('POST', { company: 'V', role: 'R', ...body }))).json()) as Application;
    expect((await post({ url: 'https://www.vandelay.example/jobs/1' })).sender_domains).toEqual(['vandelay.example']);
    expect((await post({ url: 'https://boards.greenhouse.io/v/jobs/1' })).sender_domains).toEqual([]);
    expect((await post({})).sender_domains).toEqual([]);
    expect((await post({ url: 'https://vandelay.example/1', sender_domains: ['mail.v.example'] })).sender_domains).toEqual([
      'mail.v.example',
    ]);
    const bad = await h.app.request(`${h.base}/applications`, json('POST', { company: 'V', role: 'R', sender_domains: [''] }));
    expect(bad.status).toBe(400);
    const many = await h.app.request(
      `${h.base}/applications`,
      json('POST', { company: 'V', role: 'R', sender_domains: Array.from({ length: 21 }, (_, i) => `d${i}.example`) }),
    );
    expect(many.status).toBe(400);
  });

  it('rejects non-http(s) url values on create and PATCH', async () => {
    for (const url of ['javascript:alert(1)', 'ftp://files.example/x', 'not a url']) {
      const res = await h.app.request(`${h.base}/applications`, json('POST', { company: 'V', role: 'R', url }));
      expect(res.status, url).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('url: Must be an http(s) URL');
    }
    const app = seed();
    const patch = await h.app.request(`${h.base}/applications/${app.id}`, json('PATCH', { url: 'javascript:alert(1)' }));
    expect(patch.status).toBe(400);
    const ok = await h.app.request(`${h.base}/applications/${app.id}`, json('PATCH', { url: 'http://initrode.example/j/1' }));
    expect(ok.status).toBe(200);
    const cleared = await h.app.request(`${h.base}/applications/${app.id}`, json('PATCH', { url: null }));
    expect(((await cleared.json()) as Application).url).toBeNull();
    expect(h.deps.applicationsRepo.list(h.profile.id)).toHaveLength(1);
  });

  it('GET by id includes the status history; unknown id is 404', async () => {
    const app = seed('applied');
    h.deps.applicationsRepo.setStatus(app.id, 'screening', 'user');
    const res = await h.app.request(`${h.base}/applications/${app.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Application & { history: StatusHistoryEntry[] };
    expect(body.status).toBe('screening');
    expect(body.history.map((e) => [e.from_status, e.to_status])).toEqual([['applied', 'screening']]);

    const missing = await h.app.request(`${h.base}/applications/nope`);
    expect(missing.status).toBe(404);
  });

  it('PATCH updates allowed fields and rejects unknown keys', async () => {
    const app = seed();
    const res = await h.app.request(
      `${h.base}/applications/${app.id}`,
      json('PATCH', { notes: 'called back', sender_domains: ['initrode.example'] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ notes: 'called back', sender_domains: ['initrode.example'] });

    const status = await h.app.request(`${h.base}/applications/${app.id}`, json('PATCH', { status: 'offer' }));
    expect(status.status).toBe(400);
    expect(h.deps.applicationsRepo.get(app.id)?.status).toBe('applied');

    const missing = await h.app.request(`${h.base}/applications/nope`, json('PATCH', { notes: 'x' }));
    expect(missing.status).toBe(404);
  });

  it('POST status with a bogus status is 400', async () => {
    const app = seed();
    const res = await h.app.request(`${h.base}/applications/${app.id}/status`, json('POST', { status: 'bogus' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/^status: /);
    expect(h.deps.applicationsRepo.get(app.id)?.status).toBe('applied');
  });

  it('POST status records a user history entry; unknown id is 404', async () => {
    const app = seed();
    const res = await h.app.request(`${h.base}/applications/${app.id}/status`, json('POST', { status: 'interview' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Application).status).toBe('interview');
    expect(h.deps.applicationsRepo.history(app.id).map((e) => e.source)).toEqual(['user']);

    const missing = await h.app.request(`${h.base}/applications/nope/status`, json('POST', { status: 'interview' }));
    expect(missing.status).toBe(404);
  });
});
