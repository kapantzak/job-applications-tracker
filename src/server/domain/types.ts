import type { MailFilterKind } from './mail-filter.js';

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
// `import_jobs` saves jobs another agent client found (SOW-0043); it runs no agent of its own.
export const RUN_KINDS = ['discover_jobs', 'sync_mail', 'import_jobs'] as const;
// The run kinds that spawn the user's agent; presets key model and effort by these.
export type AgentRunKind = Exclude<RunKind, 'import_jobs'>;
// What the app asks an agent to do: a queued run, or a CV analysis outside the queue (SOW-0023).
export type AgentTaskKind = AgentRunKind | 'analyse_cv';
// Logged when a run starts saving its results; the UI matches it exactly to lock the cancel control.
export const RUN_SAVING_LOG_LINE = 'Saving results; the run can no longer be cancelled';

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'aborted'] as const;
// Discovery effort (SOW-0016): `max` runs several partitioned agent processes; sync is always `default`.
export const EFFORT_MODES = ['default', 'max'] as const;
// Custom search instructions (SOW-0042): Codex receives the whole prompt as one argv element.
export const CUSTOM_PROMPT_MAX = 2000;
// Import limits (SOW-0043): keep the request and the link checks it starts bounded.
export const IMPORT_MAX_BYTES = 1024 * 1024;
export const IMPORT_MAX_JOBS = 100;
export const FIT_VERDICTS = ['pass', 'fail', 'unknown'] as const;
// Max effort workers by source family, in run order, and how many run at once (user decisions 9 and 10).
// Shared so the UI warning names exactly what the server runs.
export const MAX_EFFORT_SOURCES = [
  'Greenhouse',
  'Lever',
  'Ashby',
  'Other ATS and careers pages',
  'Remote and niche boards',
] as const;
export const MAX_EFFORT_CONCURRENCY = 3;

// A Max run that lost workers ends its summary with this note; the UI uses it to tell partial runs apart.
export const workersFailedNote = (failed: number, total: number): string => `; ${failed} of ${total} workers failed`;
// A scoped sync whose scope matched no mail ends its summary with this note (SOW-0032).
export const SCOPE_MATCHED_NOTHING_NOTE = '; the Gmail scope matched no mail';
export const hasFailedWorkers = (summary: string | null): boolean => /; \d+ of \d+ workers failed$/.test(summary ?? '');
export const VERIFICATION_STATUSES = ['ok', 'redirected', 'dead', 'unverified'] as const;
export const PROPOSAL_STATES = ['pending', 'accepted', 'rejected'] as const;
export const HISTORY_SOURCES = ['user', 'proposal'] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type RunKind = (typeof RUN_KINDS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type ProposalState = (typeof PROPOSAL_STATES)[number];
export type HistorySource = (typeof HISTORY_SOURCES)[number];
export type EffortMode = (typeof EFFORT_MODES)[number];
export type FitVerdict = (typeof FIT_VERDICTS)[number];

// The agent's verdict on each must-have from the profile; a field the profile leaves open is `pass`.
export interface FitChecks {
  location: FitVerdict;
  remote: FitVerdict;
  seniority: FitVerdict;
}

export type RemotePreference = 'remote' | 'hybrid' | 'onsite' | 'any';
export type JobRemote = 'remote' | 'hybrid' | 'onsite' | 'unknown';

// List fields are JSON text in SQLite; row types describe the parsed shape.
export interface Profile {
  id: string;
  name: string;
  // URL handle (SOW-0015): unique, follows the name, never `new`.
  slug: string;
  target_roles: string[];
  locations: string[];
  remote: RemotePreference;
  seniority: string;
  keywords: string[];
  excluded_companies: string[];
  notes: string;
  // Where sync looks in Gmail (SOW-0031): a label name or a Gmail search; '' searches by company and ATS sender.
  mail_filter_kind: MailFilterKind;
  mail_filter: string;
  // The CV kept with the profile (SOW-0023); null when the profile has none.
  cv: ProfileCv | null;
  created_at: string;
}

export interface ProfileCv {
  file_name: string;
  added_at: string;
}

// File types a CV may have (SOW-0023, decision 2); detected from the content, not the name.
export const CV_FILE_TYPES = ['pdf', 'docx', 'txt', 'md'] as const;
export type CvFileType = (typeof CV_FILE_TYPES)[number];

// interrupted: the server stopped while the agent ran; never restarted automatically (decision 26).
export const CV_ANALYSIS_STATUSES = ['running', 'succeeded', 'failed', 'interrupted'] as const;
export type CvAnalysisStatus = (typeof CV_ANALYSIS_STATUSES)[number];

// What the analysis suggests for a new profile; the user reviews it in the profile form.
export interface CvProfileDraft {
  name: string;
  target_roles: string[];
  locations: string[];
  remote: RemotePreference;
  seniority: string;
  keywords: string[];
  notes: string;
}

// One per profile plus one for a new profile (SOW-0024, decision 30); deleted on Create profile, on
// Save of an applied review, on Discard and with its profile.
export interface CvAnalysis {
  id: string;
  // null: the analysis becomes a new profile; otherwise it suggests changes to this profile.
  profile_id: string | null;
  status: CvAnalysisStatus;
  file_name: string;
  file_type: CvFileType;
  started_at: string;
  finished_at: string | null;
  draft: CvProfileDraft | null;
  error: string | null;
  created_at: string;
}

// What deleting a profile removes; shown in the confirmation dialog.
export interface ProfileCounts {
  jobs: number;
  applications: number;
  runs: number;
}

export interface ProfileListItem extends Profile {
  counts: ProfileCounts;
  // The profile's own CV analysis, if any (SOW-0024), for the badge on the Profiles screen.
  cv_analysis_status: CvAnalysisStatus | null;
}

export interface ModelOption {
  id: string;
  label: string;
  // Effort levels this model accepts, as the agent reports them.
  efforts: string[];
}

// Suggestions for the model and effort controls. `static` is a built-in list, `agent` came from the
// agent's own catalog, `unavailable` means the catalog could not be read and the user types freely.
export interface ModelCatalog {
  source: 'static' | 'agent' | 'unavailable';
  models: ModelOption[];
  // Every known effort level, for a model that is not in `models`.
  efforts: string[];
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
  // Model and effort per agent and run kind; '' means the agent's own default (no flag passed).
  claude_model_discover: string;
  claude_model_sync: string;
  claude_effort_discover: string;
  claude_effort_sync: string;
  codex_model_discover: string;
  codex_model_sync: string;
  codex_effort_discover: string;
  codex_effort_sync: string;
  // Claude Code `--max-budget-usd` per discovery agent process (each Max worker gets its own); '' = no cap.
  claude_max_budget_usd_discover: string;
  run_timeout_ms: number;
  sync_interval: 'off' | '1h' | '6h' | '24h';
  port: number;
}

export interface Run {
  id: string;
  profile_id: string;
  kind: RunKind;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  adapter_id: string;
  prompt_version: string | null;
  // Requested model and effort: '' = agent default, null = not recorded (older run, custom agent,
  // or the run never reached the agent).
  agent_model: string | null;
  agent_effort: string | null;
  // The model the agent says it ran; only Claude Code reports one.
  agent_model_reported: string | null;
  effort_mode: EffortMode;
  // The user's instructions for this discovery run (SOW-0042); null when the search had none.
  custom_prompt: string | null;
  // What the agent reported, summed over Max workers; null when nothing was reported. The cost is
  // Claude Code's list-price estimate, not a bill.
  usage_cost_usd: number | null;
  usage_input_tokens: number | null;
  usage_output_tokens: number | null;
  summary: string | null;
  error: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  profile_id: string;
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
  // JSON text in SQLite; null for jobs found before SOW-0016.
  fit_checks: FitChecks | null;
  verification_status: VerificationStatus;
  verified_at: string | null;
  dedupe_key: string;
  dismissed_at: string | null;
  created_at: string;
  // The latest search that returned this job (SOW-0040); the first search is `run_id`/`created_at`.
  last_seen_at: string;
  last_seen_run_id: string;
}

// Jobs list row: the job plus the latest application's status, so the UI can show persisted state.
export interface JobListItem extends Job {
  application_status: ApplicationStatus | null;
  // The first search, for the Jobs page "Found in" filter (SOW-0040).
  run_started_at: string | null;
  run_effort_mode: EffortMode;
  // The first search had custom instructions (SOW-0042); the text itself stays on the run.
  run_has_custom_prompt: boolean;
  // A discovery, or an import from another agent client (SOW-0043).
  run_kind: RunKind;
}

export interface Application {
  id: string;
  profile_id: string;
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
