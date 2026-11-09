import type { FunnelStage } from '../../../server/domain/dashboard.js';

// Completes "rejected after …" for each step (SOW-0036); shared by the funnel and the journey (SOW-0037).
export const AFTER_STEP: Record<FunnelStage, string> = {
  applied: 'applying',
  screening: 'screening',
  interview: 'the interview',
  offer: 'the offer',
};
