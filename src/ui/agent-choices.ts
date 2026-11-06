import type { Run, Settings } from '../server/domain/types.js';

export type PresetAgent = 'claude' | 'codex';
export type RunSuffix = 'discover' | 'sync';
export type AgentChoiceKey = `${PresetAgent}_${'model' | 'effort'}_${RunSuffix}`;

export const AGENT_CHOICE_KEYS: AgentChoiceKey[] = (['claude', 'codex'] as const).flatMap((agent) =>
  (['model', 'effort'] as const).flatMap((field) =>
    (['discover', 'sync'] as const).map((suffix): AgentChoiceKey => `${agent}_${field}_${suffix}`),
  ),
);

export const RUN_SUFFIXES: Array<{ suffix: RunSuffix; label: string; title: string }> = [
  { suffix: 'discover', label: 'discovery', title: 'Discovery' },
  { suffix: 'sync', label: 'mail sync', title: 'Mail sync' },
];

// Used when no catalog could be read: the levels `claude --help` and the codex catalog both listed (2026-11-07).
export const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function effortWarning(effort: string): string | null {
  if (effort === 'ultra') {
    return 'Ultra delegates work to subagents. Discovery is budgeted to avoid subagents, and the run may hit the run timeout.';
  }
  if (effort === 'xhigh' || effort === 'max') return 'Higher effort makes runs slower; a run may hit the run timeout.';
  return null;
}

export function isPresetAgent(id: string): id is PresetAgent {
  return id === 'claude' || id === 'codex';
}

// One line per run kind for the Dashboard, from the saved settings.
export function selectionSummary(settings: Settings, suffix: RunSuffix): string {
  const agent = settings.adapter_id;
  if (!isPresetAgent(agent)) return `${agent} · model and effort set in your custom command`;
  const model = settings[`${agent}_model_${suffix}`] || 'Agent default';
  const effort = settings[`${agent}_effort_${suffix}`] || 'Agent default';
  return `${agent} · model ${model} · effort ${effort}`;
}

function isLive(run: Run): boolean {
  return run.status === 'queued' || run.status === 'running';
}

// A live run records its agent a moment after it starts; until then nothing is "missing".
export function runAgentLabel(run: Run): string {
  if (run.adapter_id) return run.adapter_id;
  return isLive(run) ? 'Pending' : 'Not recorded';
}

// What a run asked for: '' is the agent default, null was never recorded.
export function runChoiceLabel(run: Run, field: 'agent_model' | 'agent_effort'): string {
  if (run.adapter_id === 'custom') return 'Set in your custom command';
  const value = run[field];
  if (value === null || value === undefined) return isLive(run) ? 'Pending' : 'Not recorded';
  return value === '' ? 'Agent default' : value;
}
