// How far along an application status is, for rules that must never move an application backwards: sync's
// findings (SOW-0051) and the proposals a merge moves onto the kept application (SOW-0055, decision 7B).
// Statuses that are not a step forward (saved, withdrawn, no_change) rank 0.
const STAGE: Record<string, number> = {
  applied: 1,
  no_response: 1,
  screening: 2,
  interview: 3,
  offer: 4,
  rejected: 5,
};

export const stageOf = (status: string): number => STAGE[status] ?? 0;
