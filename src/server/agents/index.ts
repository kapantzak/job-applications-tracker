import type { RunKind, Settings } from '../domain/types.js';
import { createCliAdapter } from './cli-adapter.js';
import { buildAdapterConfig } from './presets.js';
import type { AgentAdapter } from './types.js';

export type {
  AdapterHealth,
  AdapterId,
  AgentAdapter,
  AgentResult,
  AgentTask,
  CliAdapterConfig,
  RunOptions,
} from './types.js';

export function createAdapter(settings: Settings, kind: RunKind): AgentAdapter {
  return createCliAdapter(buildAdapterConfig(settings, kind));
}
