import { z } from 'zod';
import type { RunKind } from '../domain/types.js';

const DiscoveredJob = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string().default(''),
  remote: z.enum(['remote', 'hybrid', 'onsite', 'unknown']).default('unknown'),
  // Not z.url(): agents return odd but usable URLs; the verifier handles them later.
  url: z.string().min(1),
  source_site: z.string().default(''),
  posted_at: z.string().nullable().default(null),
  salary: z.string().nullable().default(null),
  description_excerpt: z.string().default(''),
  match_reason: z.string().default(''),
});

export const DiscoverJobsOutput = z.object({
  jobs: z.array(DiscoveredJob),
  notes: z.string().default(''),
});

const MailEvidence = z.object({
  message_id: z.string(),
  date: z.string(),
  from: z.string(),
  subject: z.string(),
  snippet: z.string(),
});

const MailFinding = z.object({
  application_id: z.string(),
  proposed_status: z.enum(['screening', 'interview', 'offer', 'rejected', 'no_change']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  evidence: MailEvidence,
});

export const SyncMailOutput = z.object({
  mail_access: z.boolean(),
  findings: z.array(MailFinding),
  notes: z.string().default(''),
});

export type DiscoverJobsResult = z.infer<typeof DiscoverJobsOutput>;
export type SyncMailResult = z.infer<typeof SyncMailOutput>;

// Claude Code's validator rejects zod's draft-2020-12 `$schema` pointer, and the OpenAI
// structured-output API behind Codex requires `additionalProperties: false` plus every property
// in `required`. Both accept this strict shape, so every adapter gets it; our own zod parse keeps
// its defaults and stays tolerant.
function toAgentSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toAgentSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema' || key === 'default') continue;
    out[key] = toAgentSchema(value);
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

export function outputJsonSchema(kind: RunKind): Record<string, unknown> {
  const schema = kind === 'discover_jobs' ? DiscoverJobsOutput : SyncMailOutput;
  return toAgentSchema(z.toJSONSchema(schema, { io: 'output' })) as Record<string, unknown>;
}
