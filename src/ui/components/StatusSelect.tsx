import { APPLICATION_STATUSES, type ApplicationStatus } from '../../server/domain/types.js';

interface StatusSelectProps {
  value: ApplicationStatus;
  onChange: (next: ApplicationStatus) => void;
  disabled?: boolean;
}

export function StatusSelect({ value, onChange, disabled }: StatusSelectProps) {
  return (
    <select
      aria-label="Status"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ApplicationStatus)}
    >
      {APPLICATION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
