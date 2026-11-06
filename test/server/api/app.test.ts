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

describe('error handling', () => {
  it('unexpected errors become 500 Internal error and are logged', async () => {
    h = makeHarness();
    const boom = new Error('database exploded');
    vi.spyOn(h.deps.jobsRepo, 'list').mockImplementation(() => {
      throw boom;
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await h.app.request('/api/jobs');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
    expect(logged).toHaveBeenCalledWith(boom);
  });
});
