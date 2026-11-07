// Agent-supplied dates (e.g. mail evidence) may not parse; show them as written rather than "Invalid Date".
export const formatTime = (iso: string | null): string => {
  if (!iso) return '–';
  return Number.isNaN(Date.parse(iso)) ? iso : new Date(iso).toLocaleString();
};

// The unit is chosen after rounding, so 999,960 reads "1.0M", not "1000.0k".
function compact(n: number): string {
  if (n < 1_000) return String(n);
  const thousands = (n / 1_000).toFixed(1);
  return Number(thousands) < 1_000 ? `${thousands}k` : `${(n / 1_000_000).toFixed(1)}M`;
}

// Claude reports fractions of a cent for tiny runs; "$0.00" would read as free.
const formatCost = (usd: number): string => (usd > 0 && usd < 0.005 ? '<$0.01' : `$${usd.toFixed(2)}`);

// What the agent reported for a run (SOW-0016). Claude's cost is Claude Code's own list-price estimate.
export function formatUsage(run: {
  usage_cost_usd: number | null;
  usage_input_tokens: number | null;
  usage_output_tokens: number | null;
}): string | null {
  const parts: string[] = [];
  if (run.usage_cost_usd !== null) parts.push(`${formatCost(run.usage_cost_usd)} estimated`);
  if (run.usage_input_tokens !== null || run.usage_output_tokens !== null) {
    const input = run.usage_input_tokens === null ? '?' : compact(run.usage_input_tokens);
    const output = run.usage_output_tokens === null ? '?' : compact(run.usage_output_tokens);
    parts.push(`${input} tokens in, ${output} out`);
  }
  return parts.length ? parts.join(' · ') : null;
}
