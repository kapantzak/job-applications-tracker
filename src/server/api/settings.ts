import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { Settings } from '../domain/types.js';
import { readJson } from './errors.js';

const SettingsPatch = z
  .object({
    adapter_id: z.enum(['claude', 'codex', 'custom']),
    custom_command: z.string(),
    permission_mode_discover: z.string(),
    permission_mode_sync: z.string(),
    allowed_tools_discover: z.string(),
    allowed_tools_sync: z.string(),
    sandbox_discover: z.string(),
    sandbox_sync: z.string(),
    run_timeout_ms: z.number().int().min(10_000).max(3_600_000),
    sync_interval: z.enum(['off', '1h', '6h', '24h']),
    port: z.number().int().min(1024).max(65535),
  })
  .partial()
  .strict();

export function createSettingsRouter(deps: AppDeps): Hono {
  const router = new Hono();

  router.get('/', (c) => c.json(deps.settingsRepo.getAll()));

  router.patch('/', async (c) => {
    const patch: Partial<Settings> = await readJson(c, SettingsPatch);
    const settings = deps.settingsRepo.set(patch);
    // sync_interval may have changed; the scheduler re-reads settings itself.
    deps.scheduler.refresh();
    return c.json(settings);
  });

  return router;
}
