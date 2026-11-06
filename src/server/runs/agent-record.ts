import type { AgentAdapter, AgentResult } from '../agents/types.js';
import type { AgentRunRecord } from '../db/runs-repo.js';

// Recorded before the agent starts, so a failed or aborted run still shows what was asked for.
export function requestedAgent(adapter: AgentAdapter): AgentRunRecord {
  return {
    adapter_id: adapter.id,
    agent_model: adapter.selection?.model ?? null,
    agent_effort: adapter.selection?.effort ?? null,
  };
}

export function reportedAgent(result: AgentResult): AgentRunRecord | null {
  return result.reportedModel ? { agent_model_reported: result.reportedModel } : null;
}

// Custom commands carry their own flags, so there is nothing to log for them.
export function selectionLogLine(adapter: AgentAdapter): string | null {
  const s = adapter.selection;
  if (!s) return null;
  return `Model: ${s.model || 'agent default'}, effort: ${s.effort || 'agent default'}`;
}
