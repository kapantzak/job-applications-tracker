import type { ApplicationStatus } from '../../../server/domain/types.js';

// Full class names, so Tailwind finds them when it scans the source (SOW-0034 color tokens).
export const STATUS_COLOR_CLASS: Record<ApplicationStatus, string> = {
  saved: 'bg-status-saved',
  applied: 'bg-status-applied',
  screening: 'bg-status-screening',
  interview: 'bg-status-interview',
  offer: 'bg-status-offer',
  rejected: 'bg-status-rejected',
  withdrawn: 'bg-status-withdrawn',
  no_response: 'bg-status-no-response',
};
