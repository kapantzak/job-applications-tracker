import type { RunKind } from '../domain/types.js';
import type { ResolveDeps } from './resolve-command.js';

export type AdapterId = 'claude' | 'codex' | 'custom';

export interface AdapterHealth {
  id: AdapterId;
  installed: boolean;
  version?: string;
  // Sign-in state; undefined when unknown (no probe configured, or the probe could not run).
  authenticated?: boolean;
  authMessage?: string;
  message?: string;
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

export interface AgentResult {
  ok: boolean;
  output?: unknown;
  rawStdout: string;
  rawStderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
}

export interface AgentAdapter {
  id: AdapterId;
  check(): Promise<AdapterHealth>;
  run(task: AgentTask, opts: RunOptions): Promise<AgentResult>;
}

export interface CliAdapterConfig {
  id: AdapterId;
  // Placeholders: {schema} (whole element only), {schema_file}, {prompt_file}, {output_file},
  // and any key of `vars` such as {permission_mode}, {allowed_tools}, {sandbox}.
  argv: string[];
  promptVia: 'stdin' | 'argv' | 'file';
  resultFrom: 'claude-stream-json' | 'output-file' | 'stdout-json';
  versionArgv?: string[];
  // Sign-in status command; exit 0 means signed in. Unset for custom commands.
  authArgv?: string[];
  // Test seam for the sign-in probe timeout; defaults to the version probe timeout.
  authTimeoutMs?: number;
  vars?: Record<string, string>;
  // Test seam for Windows command resolution; presets leave it unset so the real platform is used.
  resolve?: ResolveDeps;
}
