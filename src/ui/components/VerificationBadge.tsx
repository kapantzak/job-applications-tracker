import type { VerificationStatus } from '../../server/domain/types.js';

const LABELS: Record<VerificationStatus, string> = {
  ok: 'Verified',
  redirected: 'Redirected',
  unverified: 'Could not verify',
  dead: 'Dead link',
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return <span className={`badge badge-${status}`}>{LABELS[status]}</span>;
}
