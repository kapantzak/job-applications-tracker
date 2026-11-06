import { useId, useState } from 'react';
import { Trash2Icon } from 'lucide-react';
import { purgeRunLogs } from '../api/client.js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorAlert, SuccessMessage } from './feedback.js';

export function DataSection({ dataDir }: { dataDir: string | null }) {
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const purge = async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const { deleted } = await purgeRunLogs();
      setResult(`Deleted ${deleted} run logs and directories`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId}>
          <h2>Data</h2>
        </CardTitle>
        <CardDescription>Everything the app stores lives in this directory on your disk.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        <code className="rounded-md bg-muted px-2 py-1 font-mono text-sm">{dataDir ?? '-'}</code>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" disabled={busy}>
              <Trash2Icon />
              Purge run logs
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Purge run logs?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes the log file and the prompt, schema and output files of every run that is not active.
                It cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={purge}>
                Purge logs
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {result && <SuccessMessage>{result}</SuccessMessage>}
        {error && <ErrorAlert>{error}</ErrorAlert>}
      </CardContent>
    </Card>
  );
}
