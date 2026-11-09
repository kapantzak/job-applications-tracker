import type { ApplicationStatus, RunStatus, Settings } from '../server/domain/types.js';

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
