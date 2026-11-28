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

  it('PATCH stores update_check and refreshes the update checker', async () => {
    const refresh = vi.spyOn(h.deps.updateChecker, 'refresh');
    const res = await h.app.request('/api/settings', json('PATCH', { update_check: false }));
    expect(res.status).toBe(200);
    expect(h.deps.settingsRepo.getAll().update_check).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('PATCH accepts every settings key', async () => {
    const res = await h.app.request('/api/settings', json('PATCH', DEFAULT_SETTINGS));
    expect(res.status).toBe(200);
  });

  it('PATCH stores model and effort per agent and run kind, and accepts empty as agent default', async () => {
    const patch = {
      claude_model_discover: 'opus',
      claude_effort_discover: 'high',
      claude_model_sync: 'claude-model-a[1m]',
      claude_effort_sync: '',
      codex_model_discover: 'model-a.1',
      codex_effort_discover: 'ultra',
      codex_model_sync: '',
      codex_effort_sync: 'low',
    };
    const res = await h.app.request('/api/settings', json('PATCH', patch));
    expect(res.status).toBe(200);
    expect(h.deps.settingsRepo.getAll()).toEqual({ ...DEFAULT_SETTINGS, ...patch });
  });

  it.each(['', '0.5', '12.25', '9999'])('PATCH stores the Claude discovery spend cap %j', async (value) => {
    const res = await h.app.request('/api/settings', json('PATCH', { claude_max_budget_usd_discover: value }));
    expect(res.status).toBe(200);
    expect(h.deps.settingsRepo.getAll().claude_max_budget_usd_discover).toBe(value);
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
    ['model read as a flag', { claude_model_discover: '--dangerously-skip-permissions' }],
    ['model with a space', { codex_model_sync: 'model a' }],
    ['model with a quote', { codex_model_discover: 'model"a' }],
    ['model too long', { claude_model_sync: 'm'.repeat(101) }],
    ['effort with a quote', { codex_effort_discover: 'high"' }],
    ['effort uppercase', { claude_effort_sync: 'HIGH' }],
    ['effort with a flag', { claude_effort_discover: '-x' }],
    ['spend cap zero', { claude_max_budget_usd_discover: '0' }],
    ['spend cap negative', { claude_max_budget_usd_discover: '-1' }],
    ['spend cap with three decimals', { claude_max_budget_usd_discover: '1.005' }],
    ['spend cap as a number', { claude_max_budget_usd_discover: 5 }],
    ['spend cap with a flag', { claude_max_budget_usd_discover: '5 --bare' }],
    ['update check as a string', { update_check: 'false' }],
  ])('PATCH rejects %s with 400 and writes nothing', async (_name, patch) => {
    const refresh = vi.spyOn(h.deps.scheduler, 'refresh');
    const res = await h.app.request('/api/settings', json('PATCH', patch));
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as { error: unknown }).error).toBe('string');
    expect(h.deps.settingsRepo.getAll()).toEqual(DEFAULT_SETTINGS);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('default profile setting (SOW-0059)', () => {
  it('PATCH stores an existing profile as the default and clears it with an empty string', async () => {
    let res = await h.app.request('/api/settings', json('PATCH', { default_profile_id: h.profile.id }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { default_profile_id: string }).default_profile_id).toBe(h.profile.id);
    expect(h.deps.settingsRepo.getAll().default_profile_id).toBe(h.profile.id);

    res = await h.app.request('/api/settings', json('PATCH', { default_profile_id: '' }));
    expect(res.status).toBe(200);
    expect(h.deps.settingsRepo.getAll().default_profile_id).toBe('');
  });

  it('PATCH refuses an unknown profile id and writes nothing', async () => {
    const res = await h.app.request(
      '/api/settings',
      json('PATCH', { default_profile_id: 'missing', sync_interval: '6h' }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'default_profile_id: Profile not found' });
    expect(h.deps.settingsRepo.getAll()).toEqual(DEFAULT_SETTINGS);
  });

  it('PATCH refuses a default profile id that is not a string', async () => {
    const res = await h.app.request('/api/settings', json('PATCH', { default_profile_id: 7 }));
    expect(res.status).toBe(400);
    expect(h.deps.settingsRepo.getAll().default_profile_id).toBe('');
  });
});
