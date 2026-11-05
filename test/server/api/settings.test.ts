import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/server/db/settings-repo.js';
import { json, makeHarness, type Harness } from './harness.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

describe('settings', () => {
  it('GET returns the defaults', async () => {
    const res = await h.app.request('/api/settings');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_SETTINGS);
  });

  it('PATCH saves, refreshes the scheduler and returns the full settings', async () => {
    const refresh = vi.spyOn(h.deps.scheduler, 'refresh');
    const res = await h.app.request('/api/settings', json('PATCH', { sync_interval: '6h', port: 5000 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...DEFAULT_SETTINGS, sync_interval: '6h', port: 5000 });
    expect(h.deps.settingsRepo.getAll().sync_interval).toBe('6h');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('PATCH accepts every settings key', async () => {
    const res = await h.app.request('/api/settings', json('PATCH', DEFAULT_SETTINGS));
    expect(res.status).toBe(200);
  });

  it.each([
    ['unknown key', { colour: 'blue' }],
    ['bad adapter', { adapter_id: 'gpt' }],
    ['bad interval', { sync_interval: '2h' }],
    ['timeout too small', { run_timeout_ms: 9999 }],
    ['timeout too large', { run_timeout_ms: 3_600_001 }],
    ['timeout not integer', { run_timeout_ms: 20000.5 }],
    ['port too low', { port: 80 }],
    ['port too high', { port: 70000 }],
    ['string field wrong type', { custom_command: 42 }],
  ])('PATCH rejects %s with 400 and writes nothing', async (_name, patch) => {
    const refresh = vi.spyOn(h.deps.scheduler, 'refresh');
    const res = await h.app.request('/api/settings', json('PATCH', patch));
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as { error: unknown }).error).toBe('string');
    expect(h.deps.settingsRepo.getAll()).toEqual(DEFAULT_SETTINGS);
    expect(refresh).not.toHaveBeenCalled();
  });
});
