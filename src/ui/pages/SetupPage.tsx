import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRightIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError, getAdapters, getSettings, patchSettings, type AdapterStatus } from '../api/client.js';
import { AdapterChooser } from '../components/AdapterChooser.js';
import { ErrorAlert, LoadingState, SuccessMessage } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';

type AdapterId = AdapterStatus['id'];

export function SetupPage() {
  const [adapters, setAdapters] = useState<AdapterStatus[] | null>(null);
  const [adapterId, setAdapterId] = useState<AdapterId>('claude');
  const [customCommand, setCustomCommand] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getAdapters(), getSettings()])
      .then(([list, settings]) => {
        if (!active) return;
        setAdapters(list);
        setAdapterId(settings.adapter_id);
        setCustomCommand(settings.custom_command);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setError(null);
    try {
      await patchSettings({
        adapter_id: adapterId,
        custom_command: customCommand,
      });
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  if (!adapters) {
    return error ? <ErrorAlert>{error}</ErrorAlert> : <LoadingState />;
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Setup" description="Pick the agent CLI that searches for jobs and reads your mail." />
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <CardContent>
            <AdapterChooser
              adapters={adapters}
              adapterId={adapterId}
              customCommand={customCommand}
              onAdapterChange={setAdapterId}
              onCustomCommandChange={setCustomCommand}
            />
          </CardContent>
          <CardFooter className="flex flex-col items-start gap-3 border-t">
            {error && <ErrorAlert>{error}</ErrorAlert>}
            <div className="flex items-center gap-3">
              <Button type="submit">Save</Button>
              {status && <SuccessMessage>{status}</SuccessMessage>}
              {status === 'Saved' && (
                <Button asChild variant="outline">
                  <Link to="/">
                    Continue to Profiles
                    <ArrowRightIcon />
                  </Link>
                </Button>
              )}
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
