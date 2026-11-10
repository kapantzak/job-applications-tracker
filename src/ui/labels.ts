import type { ApplicationStatus, EffortMode, HistorySource, RunKind, RunStatus, Settings } from '../server/domain/types.js';

// The search modes as the Find jobs menu and the Custom search dialog offer them.
export const EFFORT_MODE_OPTIONS: Array<{ value: EffortMode; title: string; description: string }> = [
  { value: 'default', title: 'Default', description: 'One agent. Balances results and tokens.' },
  {
    value: 'max',
    title: 'Max effort',
    description: 'Five agents, one per source. Several times the tokens; asks before it starts.',
  },
];

// Display names only; stored settings keep the ids (SOW-0038 decision 5).
export const ADAPTER_LABELS: Record<Settings['adapter_id'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  custom: 'Custom command',
};

export const SYNC_INTERVAL_LABELS: Record<Settings['sync_interval'], string> = {
  off: 'Off',
  '1h': 'Every hour',
  '6h': 'Every 6 hours',
  '24h': 'Every 24 hours',
};

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  no_response: 'No response',
  withdrawn: 'Withdrawn',
};

// Run kinds and statuses as screens show them; stored values, filters' URL keys and logs keep the ids
// (SOW-0039 decisions 1, 2 and 5).
export const RUN_KIND_LABELS: Record<RunKind, string> = {
  discover_jobs: 'Job search',
  sync_mail: 'Gmail sync',
  import_jobs: 'Import',
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  // Covers a user cancel, shutdown and restart; the run's error says which.
  aborted: 'Stopped',
};

// Who changed an application's status (SOW-0039 decision 4).
export const HISTORY_SOURCE_LABELS: Record<HistorySource, string> = {
  user: 'Changed by you',
  proposal: 'Accepted from a Gmail sync proposal',
};

// One status-history entry: the first one records the status the application started with.
export const historyChangeLabel = (from: ApplicationStatus | null, to: ApplicationStatus): string =>
  from === null ? `Added as ${STATUS_LABELS[to]}` : `${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}`;

export type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

export const STATUS_TONES: Record<ApplicationStatus, BadgeTone> = {
  saved: 'outline',
  applied: 'secondary',
  screening: 'secondary',
  interview: 'default',
  offer: 'success',
  rejected: 'destructive',
  no_response: 'outline',
  withdrawn: 'outline',
};

export const RUN_STATUS_TONES: Record<RunStatus, BadgeTone> = {
  queued: 'outline',
  running: 'secondary',
  succeeded: 'success',
  failed: 'destructive',
  aborted: 'warning',
};
