import type { ApplicationStatus, RunStatus } from '../server/domain/types.js';

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
