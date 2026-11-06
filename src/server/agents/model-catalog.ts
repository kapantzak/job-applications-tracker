import { z } from 'zod';
import { EFFORT_PATTERN, MODEL_PATTERN } from './presets.js';
import type { ModelCatalog } from './types.js';

// Shape of `codex debug models` (codex-cli 0.163.0). It is a debug command with no stability promise,
// so only the fields used here are required and anything else is ignored.
const CodexCatalog = z.object({
  models: z.array(
    z.object({
      slug: z.string().min(1),
      display_name: z.string().optional(),
      visibility: z.string().optional(),
      supported_reasoning_levels: z.array(z.object({ effort: z.string().min(1) })).optional(),
    }),
  ),
});

export const UNAVAILABLE_CATALOG: ModelCatalog = { source: 'unavailable', models: [], efforts: [] };

// Throws on output that does not parse or does not match; the caller reports the catalog as unavailable.
export function parseCodexModelCatalog(text: string): ModelCatalog {
  const parsed = CodexCatalog.parse(JSON.parse(text));
  // Entries the settings API would reject are dropped, so every suggestion can be saved.
  const models = parsed.models
    .filter((m) => m.visibility !== 'hide' && MODEL_PATTERN.test(m.slug))
    .map((m) => ({
      id: m.slug,
      label: m.display_name || m.slug,
      efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter((e) => EFFORT_PATTERN.test(e)),
    }));
  const efforts = [...new Set(models.flatMap((m) => m.efforts))];
  return { source: 'agent', models, efforts };
}
