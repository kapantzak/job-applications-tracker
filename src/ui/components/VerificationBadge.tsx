import type { VerificationStatus } from '../../server/domain/types.js';
import { Badge } from '@/components/ui/badge';
import type { BadgeTone } from '../labels.js';

const LABELS: Record<VerificationStatus, string> = {
  ok: 'Verified',
  redirected: 'Redirected',
  unverified: 'Could not verify',
  dead: 'Dead link',
};

const TONES: Record<VerificationStatus, BadgeTone> = {
  ok: 'success',
  redirected: 'secondary',
  unverified: 'warning',
  dead: 'outline',
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return <Badge variant={TONES[status]}>{LABELS[status]}</Badge>;
}
