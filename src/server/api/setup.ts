import { Hono } from 'hono';
import type { AdapterHealth, AdapterId } from '../agents/index.js';
import type { AppDeps } from '../app.js';
import { APP_VERSION } from '../version.js';

type AdapterStatus = AdapterHealth & { gmail_guide: boolean };

export function createSetupRouter(deps: AppDeps): Hono {
  const router = new Hono();

  router.get('/health', (c) => c.json({ ok: true, version: APP_VERSION, dataDir: deps.dataDir }));

  router.get('/setup/adapters', async (c) => {
    const settings = deps.settingsRepo.getAll();
    const ids: AdapterId[] = ['claude', 'codex', 'custom'];
    const results = await Promise.all(
      ids.map(async (id): Promise<AdapterStatus> => {
        // Only Claude Code has a built-in Gmail connector; the others need the setup guide.
        const gmail_guide = id !== 'claude';
        // Always listed so it can be selected; there is nothing to check until a command is entered.
        if (id === 'custom' && settings.custom_command.trim() === '') {
          return { id, installed: false, message: 'Enter a command', gmail_guide };
        }
        try {
          const health = await deps.adapterFactory({ ...settings, adapter_id: id }, 'discover_jobs').check();
          return { ...health, gmail_guide };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { id, installed: false, message, gmail_guide };
        }
      }),
    );
    return c.json(results);
  });

  return router;
}
