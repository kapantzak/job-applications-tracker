import { z } from 'zod';
import { FIT_VERDICTS, type AgentTaskKind } from '../domain/types.js';

const verdict = z.enum(FIT_VERDICTS).default('unknown');
const FitChecks = z
  .object({ location: verdict, remote: verdict, seniority: verdict })
  .default({ location: 'unknown', remote: 'unknown', seniority: 'unknown' });

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
  // The agent's verdict on each must-have of the profile (SOW-0016).
  checks: FitChecks,
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

// An application the mail shows but the app does not track (SOW-0045). Status is the latest stage, the
// date the earliest message; the app turns the date into the stored timestamp.
export const NEW_APPLICATION_STATUSES = ['applied', 'screening', 'interview', 'offer', 'rejected'] as const;

export const NewApplicationFinding = z.object({
  company: z.string(),
  role: z.string(),
  status: z.enum(NEW_APPLICATION_STATUSES),
  applied_at: z.string(),
  // The company's own mail domain, '' when only an ATS wrote.
  sender_domain: z.string().default(''),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  evidence: MailEvidence,
});

export const SyncMailOutput = z.object({
  mail_access: z.boolean(),
  findings: z.array(MailFinding),
  new_applications: z.array(NewApplicationFinding).default([]),
  notes: z.string().default(''),
  // What the profile's Gmail scope matched on its own, without date limits (SOW-0032); null without a scope.
  scope_message_count: z.number().int().min(0).nullable().default(null),
});

// A CV analysis (SOW-0023). Seniority is a list of levels; the app joins it into the profile's text field.
export const AnalyseCvOutput = z.object({
  name: z.string().default(''),
  target_roles: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  remote: z.enum(['remote', 'hybrid', 'onsite', 'any']).default('any'),
  seniority: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  notes: z.string().default(''),
});

export type DiscoverJobsResult = z.infer<typeof DiscoverJobsOutput>;
export type AnalyseCvResult = z.infer<typeof AnalyseCvOutput>;
export type SyncMailResult = z.infer<typeof SyncMailOutput>;
export type NewApplicationResult = SyncMailResult['new_applications'][number];

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

const OUTPUT_SCHEMAS = { discover_jobs: DiscoverJobsOutput, sync_mail: SyncMailOutput, analyse_cv: AnalyseCvOutput };

export function outputJsonSchema(kind: AgentTaskKind): Record<string, unknown> {
  const schema = OUTPUT_SCHEMAS[kind];
  return toAgentSchema(z.toJSONSchema(schema, { io: 'output' })) as Record<string, unknown>;
}
