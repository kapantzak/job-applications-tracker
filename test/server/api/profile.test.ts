import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { json, makeHarness, SAMPLE_PROFILE, type Harness } from './harness.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

describe('profile', () => {
  it('GET returns null before a profile is saved', async () => {
    const res = await h.app.request('/api/profile');
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('PUT with an invalid body is 400 and writes nothing', async () => {
    const res = await h.app.request('/api/profile', json('PUT', { ...SAMPLE_PROFILE, remote: 'moon' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/^remote: /);
    expect(h.deps.profileRepo.get()).toBeNull();
  });

  it('PUT rejects unknown keys and non-JSON bodies', async () => {
    const extra = await h.app.request('/api/profile', json('PUT', { ...SAMPLE_PROFILE, admin: true }));
    expect(extra.status).toBe(400);
    const broken = await h.app.request('/api/profile', json('PUT', '{not json'));
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('PUT with a valid body is 200 and GET round-trips it', async () => {
    const put = await h.app.request('/api/profile', json('PUT', SAMPLE_PROFILE));
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject(SAMPLE_PROFILE);
    const get = await h.app.request('/api/profile');
    const body = (await get.json()) as Record<string, unknown>;
    expect(body).toMatchObject(SAMPLE_PROFILE);
    expect(typeof body.created_at).toBe('string');
  });
});
