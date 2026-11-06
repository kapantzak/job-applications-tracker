import { afterEach, describe, expect, it } from 'vitest';
import { hostnameOf } from '../../../src/server/api/guard.js';
import { json, makeHarness, SAMPLE_PROFILE, type Harness } from './harness.js';

let h: Harness;

afterEach(async () => {
  await h.cleanup();
});

function withHeaders(init: RequestInit, extra: Record<string, string>): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string>), ...extra } };
}

describe('request guard: Host', () => {
  it('rejects a foreign Host with 403', async () => {
    h = makeHarness();
    const res = await h.app.request('/api/health', { headers: { host: 'attacker.example:4173' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden host' });
  });

  it('rejects a missing Host with 403', async () => {
    h = makeHarness();
    const res = await h.raw.request('/api/health');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden host' });
  });

  it.each(['127.0.0.1:4173', 'localhost:4173', 'LOCALHOST', '[::1]:4173', '127.0.0.1'])(
    'accepts loopback Host %s',
    async (host) => {
      h = makeHarness();
      expect((await h.app.request('/api/health', { headers: { host } })).status).toBe(200);
    },
  );

  it('rejects look-alike Host values', async () => {
    h = makeHarness();
    for (const host of ['evil.example@127.0.0.1', '127.0.0.1.evil.example', 'localhost.evil.example:80', '127.0.0.1/x']) {
      const res = await h.app.request('/api/health', { headers: { host } });
      expect(res.status, host).toBe(403);
    }
    expect(hostnameOf('evil.example@127.0.0.1')).toBeNull();
  });

  it('allowedHosts extends the default list', async () => {
    h = makeHarness({ allowedHosts: ['tracker.invented.test'] });
    const res = await h.app.request('/api/health', { headers: { host: 'tracker.invented.test:8080' } });
    expect(res.status).toBe(200);
    expect((await h.app.request('/api/health')).status).toBe(200);
  });

  it('applies to unknown /api paths and leaves static paths alone', async () => {
    h = makeHarness();
    expect((await h.app.request('/api/nope', { headers: { host: 'attacker.example' } })).status).toBe(403);
    // No uiDir: static is a plain 404, not a guard 403.
    expect((await h.app.request('/', { headers: { host: 'attacker.example' } })).status).toBe(404);
  });
});

describe('request guard: Origin', () => {
  it('rejects a foreign Origin on POST with 403 and does not run the handler', async () => {
    h = makeHarness();
    const res = await h.app.request('/api/runs/sync', {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden origin' });
    expect(h.deps.runsRepo.list()).toEqual([]);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('rejects a foreign Origin on %s', async (method) => {
    h = makeHarness();
    const path = method === 'PUT' ? '/api/profile' : method === 'PATCH' ? '/api/settings' : '/api/runs/logs';
    const res = await h.app.request(path, withHeaders(json(method, {}), { origin: 'http://attacker.example' }));
    expect(res.status).toBe(403);
  });

  it('rejects the opaque "null" Origin on writes', async () => {
    h = makeHarness();
    const res = await h.app.request('/api/runs/sync', { method: 'POST', headers: { origin: 'null' } });
    expect(res.status).toBe(403);
  });

  it('lets a same-origin POST through', async () => {
    h = makeHarness();
    const res = await h.app.request(
      '/api/profile',
      withHeaders(json('PUT', SAMPLE_PROFILE), { origin: 'http://127.0.0.1:4173' }),
    );
    expect(res.status).toBe(200);
    const post = await h.app.request('/api/runs/sync', { method: 'POST', headers: { origin: 'http://localhost:4173' } });
    expect(post.status).toBe(202);
  });

  it('allows a GET with a foreign Origin', async () => {
    h = makeHarness();
    const res = await h.app.request('/api/health', { headers: { origin: 'https://attacker.example' } });
    expect(res.status).toBe(200);
  });
});

describe('JSON content type', () => {
  it('rejects a JSON POST without Content-Type with 415', async () => {
    h = makeHarness();
    const res = await h.app.request('/api/applications', {
      method: 'POST',
      body: JSON.stringify({ company: 'Vandelay', role: 'Importer' }),
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Content-Type must be application/json' });
    expect(h.deps.applicationsRepo.list()).toEqual([]);
  });

  it('rejects a form-encoded body with 415', async () => {
    h = makeHarness();
    const res = await h.app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'sync_interval=1h',
    });
    expect(res.status).toBe(415);
  });

  it('accepts application/json with a charset', async () => {
    h = makeHarness();
    const res = await h.app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ sync_interval: '1h' }),
    });
    expect(res.status).toBe(200);
  });
});
