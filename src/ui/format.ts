// Agent-supplied dates (e.g. mail evidence) may not parse; show them as written rather than "Invalid Date".
export const formatTime = (iso: string | null): string => {
  if (!iso) return '–';
  return Number.isNaN(Date.parse(iso)) ? iso : new Date(iso).toLocaleString();
};

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// What the agent reported for a run (SOW-0016). Claude's cost is Claude Code's own list-price estimate.
export function formatUsage(run: {
  usage_cost_usd: number | null;
  usage_input_tokens: number | null;
  usage_output_tokens: number | null;
}): string | null {
  const parts: string[] = [];
  if (run.usage_cost_usd !== null) parts.push(`$${run.usage_cost_usd.toFixed(2)} estimated`);
  if (run.usage_input_tokens !== null || run.usage_output_tokens !== null) {
    const input = run.usage_input_tokens === null ? '?' : compact(run.usage_input_tokens);
    const output = run.usage_output_tokens === null ? '?' : compact(run.usage_output_tokens);
    parts.push(`${input} tokens in, ${output} out`);
  }
  return parts.length ? parts.join(' · ') : null;
}
