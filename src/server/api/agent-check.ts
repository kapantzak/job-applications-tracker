import type { AgentAdapter } from '../agents/index.js';
import type { AppDeps } from '../app.js';
import type { AgentTaskKind } from '../domain/types.js';
import { HttpError } from './errors.js';

// Fails fast with a 422 the UI can show, instead of starting agent work that can only fail.
export async function requireUsableAgent(deps: AppDeps, kind: AgentTaskKind): Promise<void> {
  let adapter: AgentAdapter;
  try {
    adapter = deps.adapterFactory(deps.settingsRepo.getAll(), kind);
  } catch (err) {
    throw new HttpError(422, `Agent command is invalid: ${err instanceof Error ? err.message : String(err)}`);
  }
  const health = await adapter.check();
  if (!health.installed) {
    const detail = health.message ? `: ${health.message}` : '';
    throw new HttpError(422, `Agent "${health.id}" is not installed${detail}`);
  }
}
