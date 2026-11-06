// Enum value lists are exported as const arrays so repositories can validate input.
export const APPLICATION_STATUSES = [
  'saved',
  'applied',
  'screening',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'no_response',
] as const;
export const RUN_KINDS = ['discover_jobs', 'sync_mail'] as const;
export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'aborted'] as const;
export const VERIFICATION_STATUSES = ['ok', 'redirected', 'dead', 'unverified'] as const;
export const PROPOSAL_STATES = ['pending', 'accepted', 'rejected'] as const;
export const HISTORY_SOURCES = ['user', 'proposal'] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type RunKind = (typeof RUN_KINDS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type ProposalState = (typeof PROPOSAL_STATES)[number];
export type HistorySource = (typeof HISTORY_SOURCES)[number];

export type RemotePreference = 'remote' | 'hybrid' | 'onsite' | 'any';
export type JobRemote = 'remote' | 'hybrid' | 'onsite' | 'unknown';

// List fields are JSON text in SQLite; row types describe the parsed shape.
export interface Profile {
  target_roles: string[];
  locations: string[];
  remote: RemotePreference;
  seniority: string;
  keywords: string[];
  excluded_companies: string[];
  notes: string;
  created_at: string;
}

export interface Settings {
  adapter_id: 'claude' | 'codex' | 'custom';
  custom_command: string;
  permission_mode_discover: string;
  permission_mode_sync: string;
  allowed_tools_discover: string;
  allowed_tools_sync: string;
  sandbox_discover: string;
  sandbox_sync: string;
  run_timeout_ms: number;
  sync_interval: 'off' | '1h' | '6h' | '24h';
  port: number;
}

export interface Run {
  id: string;
  kind: RunKind;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  adapter_id: string;
  prompt_version: string | null;
  summary: string | null;
  error: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  run_id: string;
  company: string;
  title: string;
  location: string | null;
  remote: JobRemote;
  url: string;
  canonical_url: string;
  source_site: string | null;
  posted_at: string | null;
  salary: string | null;
  description_excerpt: string | null;
  match_reason: string | null;
  verification_status: VerificationStatus;
  verified_at: string | null;
  dedupe_key: string;
  dismissed_at: string | null;
  created_at: string;
}

// Jobs list row: the job plus the latest application's status, so the UI can show persisted state.
export interface JobListItem extends Job {
  application_status: ApplicationStatus | null;
}

export interface Application {
  id: string;
  job_id: string | null;
  company: string;
  role: string;
  url: string | null;
  status: ApplicationStatus;
  applied_at: string | null;
  status_changed_at: string;
  notes: string | null;
  sender_domains: string[];
  created_at: string;
}

export interface StatusHistoryEntry {
  id: string;
  application_id: string;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  changed_at: string;
  source: HistorySource;
  proposal_id: string | null;
  created_at: string;
}

export interface ProposalEvidence {
  message_id: string;
  date: string;
  from: string;
  subject: string;
  snippet: string;
}

export interface Proposal {
  id: string;
  run_id: string;
  application_id: string;
  proposed_status: ApplicationStatus;
  confidence: number;
  reason: string;
  evidence: ProposalEvidence;
  state: ProposalState;
  decided_at: string | null;
  created_at: string;
}
