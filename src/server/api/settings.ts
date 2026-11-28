import { Hono } from 'hono';
import { z } from 'zod';
import { BUDGET_PATTERN, EFFORT_PATTERN, MODEL_PATTERN } from '../agents/presets.js';
import type { AppDeps } from '../app.js';
import type { Settings } from '../domain/types.js';
import { HttpError, readJson } from './errors.js';

// '' selects the agent's own default.
const model = z.union([z.literal(''), z.string().regex(MODEL_PATTERN, 'Invalid model id')]);
const effort = z.union([z.literal(''), z.string().regex(EFFORT_PATTERN, 'Invalid effort level')]);
// '' turns the cap off.
const budget = z.union([
  z.literal(''),
  z
    .string()
    .regex(BUDGET_PATTERN, 'Invalid spend cap')
    .refine((v) => Number(v) > 0, 'Spend cap must be more than 0'),
]);

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
    claude_model_discover: model,
    claude_model_sync: model,
    claude_effort_discover: effort,
    claude_effort_sync: effort,
    codex_model_discover: model,
    codex_model_sync: model,
    codex_effort_discover: effort,
    codex_effort_sync: effort,
    claude_max_budget_usd_discover: budget,
    run_timeout_ms: z.number().int().min(10_000).max(3_600_000),
    sync_interval: z.enum(['off', '1h', '6h', '24h']),
    port: z.number().int().min(1024).max(65535),
    update_check: z.boolean(),
    default_profile_id: z.string(),
  })
  .partial()
  .strict();

export function createSettingsRouter(deps: AppDeps): Hono {
  const router = new Hono();

  router.get('/', (c) => c.json(deps.settingsRepo.getAll()));

  router.patch('/', async (c) => {
    const patch: Partial<Settings> = await readJson(c, SettingsPatch);
    // Checked before any write, so a bad patch stores nothing; '' clears the default.
    if (patch.default_profile_id && !deps.profilesRepo.get(patch.default_profile_id)) {
      throw new HttpError(400, 'default_profile_id: Profile not found');
    }
    const settings = deps.settingsRepo.set(patch);
    // sync_interval or update_check may have changed; both re-read settings themselves.
    deps.scheduler.refresh();
    deps.updateChecker.refresh();
    return c.json(settings);
  });

  return router;
}
