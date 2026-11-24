import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, type Harness } from './harness.js';

let h: Harness;
let tmp: string;
let uiDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'jobtrack-api-ui-'));
  uiDir = join(tmp, 'ui');
  mkdirSync(join(uiDir, 'assets'), { recursive: true });
  writeFileSync(join(uiDir, 'index.html'), '<!doctype html><title>invented ui</title>');
  writeFileSync(join(uiDir, 'assets', 'app.js'), 'console.log("invented");');
  mkdirSync(join(uiDir, 'licenses'));
  writeFileSync(join(uiDir, 'licenses', 'font.txt'), 'invented licence');
  writeFileSync(join(tmp, 'secret.txt'), 'outside the ui dir');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await h.cleanup();
  rmSync(tmp, { recursive: true, force: true });
});

describe('static UI', () => {
  it('GET / serves index.html and unknown paths fall back to it', async () => {
    h = makeHarness({ uiDir });
    const root = await h.app.request('/');
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await root.text()).toContain('invented ui');
    const deep = await h.app.request('/anything');
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('invented ui');
  });

  it('serves real files with their mime type', async () => {
    h = makeHarness({ uiDir });
    const res = await h.app.request('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(await res.text()).toContain('invented');
  });

  it('never serves files outside uiDir', async () => {
    h = makeHarness({ uiDir });
    for (const path of ['/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt', '/../secret.txt']) {
      const res = await h.app.request(path);
      expect(await res.text(), path).not.toContain('outside the ui dir');
    }
    expect((await h.app.request('/..%2fsecret.txt')).status).toBe(404);
  });

  it('unknown /api paths stay JSON 404 even with a UI', async () => {
    h = makeHarness({ uiDir });
    const res = await h.app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('without uiDir non-api paths are 404', async () => {
    h = makeHarness({ uiDir: null });
    expect((await h.app.request('/')).status).toBe(404);
    expect((await h.app.request('/anything')).status).toBe(404);
  });
});

describe('static UI cache headers', () => {
  const IMMUTABLE = 'public, max-age=31536000, immutable';

  it('index.html and client routes must revalidate on every load', async () => {
    h = makeHarness({ uiDir });
    for (const path of ['/', '/index.html', '/profiles/platform-roles/jobs']) {
      const res = await h.app.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('cache-control'), path).toBe('no-cache');
    }
  });

  it('hashed files under assets/ are cached as immutable', async () => {
    h = makeHarness({ uiDir });
    const res = await h.app.request('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE);
  });

  it('a missing file under assets/ falls back to index.html without immutable', async () => {
    h = makeHarness({ uiDir });
    const res = await h.app.request('/assets/gone-1234.js');
    expect(await res.text()).toContain('invented ui');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('unhashed files outside assets/ must revalidate', async () => {
    h = makeHarness({ uiDir });
    const res = await h.app.request('/licenses/font.txt');
    expect(await res.text()).toBe('invented licence');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('a sibling folder whose name starts with assets is not treated as assets/', async () => {
    mkdirSync(join(uiDir, 'assets-other'));
    writeFileSync(join(uiDir, 'assets-other', 'b.js'), 'console.log("sibling");');
    h = makeHarness({ uiDir });
    const res = await h.app.request('/assets-other/b.js');
    expect(await res.text()).toContain('sibling');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('HEAD and range requests on an asset keep the immutable header', async () => {
    h = makeHarness({ uiDir });
    const head = await h.app.request('/assets/app.js', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe(IMMUTABLE);
    const range = await h.app.request('/assets/app.js', { headers: { Range: 'bytes=0-3' } });
    expect(range.status).toBe(206);
    expect(range.headers.get('cache-control')).toBe(IMMUTABLE);
  });

  it('api responses get no cache header from the static handler', async () => {
    h = makeHarness({ uiDir });
    const health = await h.app.request('/api/health');
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBeNull();
    const missing = await h.app.request('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBeNull();
  });
});

describe('error handling', () => {
  it('unexpected errors become 500 Internal error and are logged', async () => {
    h = makeHarness();
    const boom = new Error('database exploded');
    vi.spyOn(h.deps.jobsRepo, 'list').mockImplementation(() => {
      throw boom;
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await h.app.request(`${h.base}/jobs`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
    expect(logged).toHaveBeenCalledWith(boom);
  });
});
