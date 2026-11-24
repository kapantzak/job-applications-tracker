import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Application, StatusHistoryEntry } from '../../../src/server/domain/types.js';
import type { HistoryRow } from '../../../src/server/domain/dashboard.js';
import { json, makeHarness, SAMPLE_PROFILE, type Harness } from './harness.js';

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

  it("GET history lists the profile's status changes oldest first, without other profiles' rows", async () => {
    const a = seed('applied');
    const b = seed('applied');
    h.deps.applicationsRepo.setStatus(a.id, 'screening', 'user');
    h.deps.applicationsRepo.setStatus(b.id, 'rejected', 'user');
    h.deps.applicationsRepo.setStatus(a.id, 'interview', 'user');
    const other = h.deps.profilesRepo.create({ ...SAMPLE_PROFILE, name: 'Data roles' });
    const foreign = h.deps.applicationsRepo.create({ profile_id: other.id, company: 'Globex', role: 'SRE', status: 'applied' });
    h.deps.applicationsRepo.setStatus(foreign.id, 'offer', 'user');

    const res = await h.app.request(`${h.base}/applications/history`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as HistoryRow[];
    expect(rows.map((r) => [r.application_id, r.from_status, r.to_status])).toEqual([
      [a.id, 'applied', 'screening'],
      [b.id, 'applied', 'rejected'],
      [a.id, 'screening', 'interview'],
    ]);
    // Only the fields the Dashboard reads.
    expect(Object.keys(rows[0]!).sort()).toEqual(['application_id', 'changed_at', 'from_status', 'to_status']);
  });

  it('GET history of an unknown profile is 404', async () => {
    const res = await h.app.request('/api/profiles/no-such-profile/applications/history');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('Profile not found');
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

describe('POST applications/merge (SOW-0055)', () => {
  const merge = (body: unknown, base = h.base) => h.app.request(`${base}/applications/merge`, json('POST', body));
  const make = (role: string, over: Partial<Parameters<Harness['deps']['applicationsRepo']['create']>[0]> = {}) =>
    h.deps.applicationsRepo.create({ profile_id: h.profile.id, company: 'Initrode', role, ...over });

  it('merges into the kept application and returns it with its history and aliases', async () => {
    const kept = make('SRE', { status: 'interview' });
    const other = make('Site Reliability Engineer', { url: 'https://initrode.example/j/1' });
    h.deps.applicationsRepo.setStatus(other.id, 'screening', 'user');

    const res = await merge({ keep_id: kept.id, merge_ids: [other.id] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Application & { history: StatusHistoryEntry[]; aliases: unknown[] };
    expect(body).toMatchObject({ id: kept.id, status: 'interview', url: 'https://initrode.example/j/1' });
    expect(body.history.map((e) => [e.from_status, e.to_status])).toEqual([['applied', 'screening']]);
    expect(body.aliases).toEqual([{ company: 'Initrode', role: 'Site Reliability Engineer' }]);
    expect(h.deps.applicationsRepo.list(h.profile.id).map((a) => a.id)).toEqual([kept.id]);
  });

  it('GET of an application includes its aliases', async () => {
    const kept = make('SRE');
    const other = make('Ops');
    h.deps.applicationsRepo.merge(kept.id, [other.id]);
    const body = (await (await h.app.request(`${h.base}/applications/${kept.id}`)).json()) as { aliases: unknown[] };
    expect(body.aliases).toEqual([{ company: 'Initrode', role: 'Ops' }]);
  });

  it.each([
    ['no ids to merge', (k: string) => ({ keep_id: k, merge_ids: [] })],
    ['more than 50 ids', (k: string) => ({ keep_id: k, merge_ids: Array.from({ length: 51 }, (_, i) => `app-${i}`) })],
    ['a repeated id', (k: string, o: string) => ({ keep_id: k, merge_ids: [o, o] })],
    ['the kept id among the merged', (k: string, o: string) => ({ keep_id: k, merge_ids: [o, k] })],
    ['an unknown key', (k: string, o: string) => ({ keep_id: k, merge_ids: [o], force: true })],
  ])('is 400 and merges nothing for %s', async (_name, body) => {
    const kept = make('SRE');
    const other = make('Ops');
    const res = await merge(body(kept.id, other.id));
    expect(res.status).toBe(400);
    expect(h.deps.applicationsRepo.list(h.profile.id)).toHaveLength(2);
  });

  it('is 404 and merges nothing for an unknown id or another profile\'s application', async () => {
    const other = h.deps.profilesRepo.create({ ...SAMPLE_PROFILE, name: 'Data roles' });
    const kept = make('SRE');
    const mine = make('Ops');
    const theirs = h.deps.applicationsRepo.create({ profile_id: other.id, company: 'Initrode', role: 'SRE' });
    for (const body of [
      { keep_id: kept.id, merge_ids: [mine.id, 'nope'] },
      { keep_id: kept.id, merge_ids: [mine.id, theirs.id] },
      { keep_id: theirs.id, merge_ids: [mine.id] },
    ]) {
      const res = await merge(body);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Application not found' });
    }
    expect(h.deps.applicationsRepo.list(h.profile.id)).toHaveLength(2);
    expect(h.deps.applicationsRepo.get(theirs.id)).not.toBeNull();
  });

  it.each(['queued', 'running'] as const)('is 409 while a Gmail sync of the profile is %s', async (status) => {
    const kept = make('SRE');
    const other = make('Ops');
    const run = h.deps.runsRepo.create('sync_mail', h.profile.id, { adapter_id: '', prompt_version: null });
    h.deps.runsRepo.update(run.id, { status });
    const res = await merge({ keep_id: kept.id, merge_ids: [other.id] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'A Gmail sync of this profile is queued or running; wait for it to finish' });
    expect(h.deps.applicationsRepo.list(h.profile.id)).toHaveLength(2);
  });

  it('merges while a job search or another profile\'s Gmail sync is queued', async () => {
    const other = h.deps.profilesRepo.create({ ...SAMPLE_PROFILE, name: 'Data roles' });
    h.deps.runsRepo.create('sync_mail', other.id, { adapter_id: '', prompt_version: null });
    h.deps.runsRepo.create('discover_jobs', h.profile.id, { adapter_id: '', prompt_version: null });
    const kept = make('SRE');
    const res = await merge({ keep_id: kept.id, merge_ids: [make('Ops').id] });
    expect(res.status).toBe(200);
  });

  it('is 415 without a JSON content type', async () => {
    const kept = make('SRE');
    const res = await h.app.request(`${h.base}/applications/merge`, {
      method: 'POST',
      body: JSON.stringify({ keep_id: kept.id, merge_ids: [make('Ops').id] }),
    });
    expect(res.status).toBe(415);
  });
});
