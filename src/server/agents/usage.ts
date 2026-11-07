import type { AgentUsage } from './types.js';

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

function jsonEvents(ndjson: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of ndjson.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed) as unknown;
      if (event && typeof event === 'object' && !Array.isArray(event)) out.push(event as Record<string, unknown>);
    } catch {
      // Non-JSON lines are ignored.
    }
  }
  return out;
}

function hasAny(u: AgentUsage): boolean {
  return u.costUsd !== undefined || u.inputTokens !== undefined || u.outputTokens !== undefined;
}

// Claude Code's last `result` event, on success and on error results such as `error_max_budget_usd`.
// `total_cost_usd` and `modelUsage` include sub-agents; `usage` covers the main loop only, so it is a
// fallback. Input tokens count cache reads and writes too, since those are what a run loads.
export function extractClaudeUsage(ndjson: string): AgentUsage | undefined {
  const result = jsonEvents(ndjson)
    .filter((e) => e.type === 'result')
    .at(-1);
  if (!result) return undefined;
  const usage: AgentUsage = {};
  const cost = num(result.total_cost_usd);
  if (cost !== undefined) usage.costUsd = cost;

  const models = result.modelUsage;
  const perModel =
    models && typeof models === 'object' && !Array.isArray(models)
      ? Object.values(models as Record<string, unknown>).filter(
          (m): m is Record<string, unknown> => !!m && typeof m === 'object',
        )
      : [];
  const sum = (rows: Record<string, unknown>[], keys: string[]): number | undefined => {
    let total: number | undefined;
    for (const row of rows) {
      for (const key of keys) {
        const v = num(row[key]);
        if (v !== undefined) total = (total ?? 0) + v;
      }
    }
    return total;
  };
  if (perModel.length) {
    const input = sum(perModel, ['inputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens']);
    const output = sum(perModel, ['outputTokens']);
    if (input !== undefined) usage.inputTokens = input;
    if (output !== undefined) usage.outputTokens = output;
  } else if (result.usage && typeof result.usage === 'object') {
    const u = result.usage as Record<string, unknown>;
    const input = sum([u], ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']);
    const output = sum([u], ['output_tokens']);
    if (input !== undefined) usage.inputTokens = input;
    if (output !== undefined) usage.outputTokens = output;
  }
  return hasAny(usage) ? usage : undefined;
}

// codex `exec --json`: `turn.completed.usage` is the thread's running total (codex-rs/exec
// `usage_from_last_total`), so the last event is the run's usage; summing would double count.
// `input_tokens` already includes `cached_input_tokens`. Codex reports no cost.
export function extractCodexUsage(ndjson: string): AgentUsage | undefined {
  const last = jsonEvents(ndjson)
    .filter((e) => e.type === 'turn.completed')
    .at(-1);
  const u = last?.usage;
  if (!u || typeof u !== 'object') return undefined;
  const usage: AgentUsage = {};
  const input = num((u as Record<string, unknown>).input_tokens);
  const output = num((u as Record<string, unknown>).output_tokens);
  if (input !== undefined) usage.inputTokens = input;
  if (output !== undefined) usage.outputTokens = output;
  return hasAny(usage) ? usage : undefined;
}

// Sums worker usages; a field stays undefined only when no worker reported it.
export function sumUsage(items: (AgentUsage | undefined)[]): AgentUsage | undefined {
  const total: AgentUsage = {};
  for (const u of items) {
    if (!u) continue;
    for (const key of ['costUsd', 'inputTokens', 'outputTokens'] as const) {
      if (u[key] !== undefined) total[key] = (total[key] ?? 0) + u[key];
    }
  }
  return hasAny(total) ? total : undefined;
}
