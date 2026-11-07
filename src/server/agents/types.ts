import type { ModelCatalog, RunKind } from '../domain/types.js';
import type { ResolveDeps } from './resolve-command.js';

export type AdapterId = 'claude' | 'codex' | 'custom';

// Shared with the UI, so they live with the domain types.
export type { ModelCatalog, ModelOption } from '../domain/types.js';

export interface AdapterHealth {
  id: AdapterId;
  installed: boolean;
  version?: string;
  // Sign-in state; undefined when unknown (no probe configured, or the probe could not run).
  authenticated?: boolean;
  authMessage?: string;
  message?: string;
}

// What the app asks the agent for; '' means the agent's own default (no flag passed).
export interface AgentSelection {
  model: string;
  effort: string;
}

export interface AgentTask {
  kind: RunKind;
  prompt: string;
  outputSchema: Record<string, unknown>;
}

export interface RunOptions {
  timeoutMs: number;
  // Run directory; prompt, schema and output files are written here and kept for debugging.
  cwd: string;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

// What the agent reports about one run. Claude's cost is Claude Code's own list-price estimate, not a bill.
export interface AgentUsage {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AgentResult {
  ok: boolean;
  output?: unknown;
  rawStdout: string;
  rawStderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
  // Model named by the agent's own output (Claude Code init event); set on failures too when seen.
  reportedModel?: string;
  // Read on failures too: a capped or timed-out run has still spent tokens.
  usage?: AgentUsage;
}

export interface AgentAdapter {
  id: AdapterId;
  // Undefined for custom commands, which carry their own flags.
  selection?: AgentSelection;
  check(): Promise<AdapterHealth>;
  // Never rejects; a failed catalog read comes back as `source: 'unavailable'`.
  listModels(): Promise<ModelCatalog>;
  run(task: AgentTask, opts: RunOptions): Promise<AgentResult>;
}

export interface CliAdapterConfig {
  id: AdapterId;
  // Placeholders: {schema} (whole element only), {schema_file}, {prompt_file}, {output_file},
  // and any key of `vars` such as {permission_mode}, {allowed_tools}, {sandbox}.
  argv: string[];
  promptVia: 'stdin' | 'argv' | 'file';
  resultFrom: 'claude-stream-json' | 'output-file' | 'stdout-json';
  // Where stdout reports usage; unset for custom commands.
  usageFrom?: 'claude-stream-json' | 'codex-json';
  versionArgv?: string[];
  // Sign-in status command; exit 0 means signed in. Unset for custom commands.
  authArgv?: string[];
  // Test seam for the sign-in probe timeout; defaults to the version probe timeout.
  authTimeoutMs?: number;
  vars?: Record<string, string>;
  selection?: AgentSelection;
  // Built-in model suggestions, for agents without a catalog command.
  modelCatalog?: ModelCatalog;
  // Command that prints the agent's model catalog as JSON (codex `debug models`).
  modelsArgv?: string[];
  // Test seam for Windows command resolution; presets leave it unset so the real platform is used.
  resolve?: ResolveDeps;
}
