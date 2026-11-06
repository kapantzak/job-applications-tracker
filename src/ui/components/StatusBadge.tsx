import type { ApplicationStatus } from '../../server/domain/types.js';
import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS, STATUS_TONES } from '../labels.js';

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge variant={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}
