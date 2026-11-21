import type { ApplicationStatus } from '../../../server/domain/types.js';

// Status colour tokens for drawings that set colours through style (SOW-0037 journey graph).
export const STATUS_COLOR_VAR: Record<ApplicationStatus, string> = {
  saved: 'var(--status-saved)',
  applied: 'var(--status-applied)',
  screening: 'var(--status-screening)',
  interview: 'var(--status-interview)',
  offer: 'var(--status-offer)',
  rejected: 'var(--status-rejected)',
  withdrawn: 'var(--status-withdrawn)',
  no_response: 'var(--status-no-response)',
};
