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

// Input view: fields with defaults stay optional for the agent.
export function outputJsonSchema(kind: RunKind): Record<string, unknown> {
  const schema = kind === 'discover_jobs' ? DiscoverJobsOutput : SyncMailOutput;
  return z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
}
