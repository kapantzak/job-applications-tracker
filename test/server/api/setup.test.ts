import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../../src/server/version.js';
import { makeHarness, type Harness } from './harness.js';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(async () => {
  await h.cleanup();
});

describe('health', () => {
  it('returns ok, the app version and the data dir', async () => {
    const res = await h.app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: APP_VERSION, dataDir: '/invented/data-dir' });
  });
});

describe('setup adapters', () => {
  it('checks claude and codex, flags the gmail guide for non-claude ids', async () => {
    h.healthFor.codex = { id: 'codex', installed: false, message: 'not on PATH' };
    const res = await h.app.request('/api/setup/adapters');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 'claude', installed: true, version: '0.0.1-test', gmail_guide: false },
      { id: 'codex', installed: false, message: 'not on PATH', gmail_guide: true },
      { id: 'custom', installed: false, message: 'Enter a command', gmail_guide: true },
    ]);
    expect(h.factoryCalls.map((c) => [c.settings.adapter_id, c.kind])).toEqual([
      ['claude', 'discover_jobs'],
      ['codex', 'discover_jobs'],
    ]);
  });

  it('lists custom as not installed on a fresh database without checking it', async () => {
    expect(h.deps.settingsRepo.getAll().custom_command).toBe('');
    const body = (await (await h.app.request('/api/setup/adapters')).json()) as { id: string }[];
    expect(body.find((a) => a.id === 'custom')).toEqual({
      id: 'custom',
      installed: false,
      message: 'Enter a command',
      gmail_guide: true,
    });
    expect(h.factoryCalls.some((c) => c.settings.adapter_id === 'custom')).toBe(false);
  });

  it('includes custom when a custom command is set and turns a throwing check into not installed', async () => {
    h.deps.settingsRepo.set({ custom_command: 'my-agent --json' });
    h.healthFor.claude = new Error('spawn failed');
    const res = await h.app.request('/api/setup/adapters');
    const body = (await res.json()) as { id: string }[];
    expect(body).toEqual([
      { id: 'claude', installed: false, message: 'spawn failed', gmail_guide: false },
      { id: 'codex', installed: true, version: '0.0.1-test', gmail_guide: true },
      { id: 'custom', installed: true, version: '0.0.1-test', gmail_guide: true },
    ]);
    expect(h.factoryCalls.find((c) => c.settings.adapter_id === 'custom')?.settings.custom_command).toBe(
      'my-agent --json',
    );
  });
});
