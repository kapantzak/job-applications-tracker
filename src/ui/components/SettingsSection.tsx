import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { patchSettings } from '../api/client.js';
import type { Settings } from '../../server/domain/types.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { ErrorAlert, SuccessMessage } from './feedback.js';

interface SettingsSectionProps {
  title: string;
  description?: ReactNode;
  // Only this section's keys, so a validation error elsewhere cannot block the save.
  getPatch: () => Partial<Settings>;
  children: ReactNode;
}

export function SettingsSection({ title, description, getPatch, children }: SettingsSectionProps) {
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await patchSettings(getPatch());
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card role="region" aria-labelledby={headingId}>
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle id={headingId}>
            <h2>{title}</h2>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <FieldGroup>{children}</FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-col items-start gap-3 border-t">
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
            {saved && <SuccessMessage>Saved</SuccessMessage>}
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
