import { APPLICATION_STATUSES, type ApplicationStatus } from '../../server/domain/types.js';
import { STATUS_LABELS } from '../labels.js';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

interface StatusSelectProps {
  id?: string;
  value: ApplicationStatus;
  onChange: (next: ApplicationStatus) => void;
  disabled?: boolean;
  size?: 'sm' | 'default';
}

export function StatusSelect({ id, value, onChange, disabled, size }: StatusSelectProps) {
  return (
    <NativeSelect
      id={id}
      aria-label="Status"
      size={size}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ApplicationStatus)}
    >
      {APPLICATION_STATUSES.map((s) => (
        <NativeSelectOption key={s} value={s}>
          {STATUS_LABELS[s]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
