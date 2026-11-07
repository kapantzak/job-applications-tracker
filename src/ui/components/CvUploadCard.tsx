import { useId, useRef, useState, type DragEvent } from 'react';
import { FileTextIcon, SparklesIcon, UploadIcon } from 'lucide-react';
import type { CvAnalysis } from '../../server/domain/types.js';
import { ApiError, uploadCv } from '../api/client.js';
import { CvIllustration } from './CvIllustration.js';
import { ErrorAlert } from './feedback.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// What the server accepts (SOW-0023, decision 2); it checks the content, this only steers the picker.
const ACCEPT = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';
const MAX_BYTES = 10 * 1024 * 1024;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The prominent choice on the create-profile screens (decision 8): drop or pick a CV, then analyse it.
interface CvUploadCardProps {
  onStarted: (analysis: CvAnalysis) => void;
  // A 409 means an analysis already exists (another tab started one); re-reading shows it.
  onStale: () => void;
}

export function CvUploadCard({ onStarted, onStale }: CvUploadCardProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (picked: File | undefined) => {
    setError(null);
    if (!picked) return;
    if (picked.size > MAX_BYTES) {
      setFile(null);
      setError('The file is larger than 10 MB');
      return;
    }
    setFile(picked);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files[0]);
  };

  const analyse = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onStarted(await uploadCv(file));
    } catch (e) {
      setError(message(e));
      setBusy(false);
      if (e instanceof ApiError && e.status === 409) onStale();
    }
  };

  return (
    <Card className="border-primary/40 bg-gradient-to-b from-primary/5 to-card shadow-md">
      <CardHeader className="flex flex-col items-center gap-2 text-center">
        <CvIllustration className="w-44" />
        <CardTitle className="flex items-center gap-2 text-lg">
          <h2>Start from your CV</h2>
          <Badge>Recommended</Badge>
        </CardTitle>
        <CardDescription className="max-w-sm">
          AI reads your CV and fills in the profile. You review every field before it is saved.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          data-testid="cv-drop-zone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
            dragging ? 'border-primary bg-primary/10' : 'border-border bg-background/60',
          )}
        >
          <Input
            ref={input}
            id={inputId}
            type="file"
            accept={ACCEPT}
            aria-label="CV file"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              choose(e.target.files?.[0]);
              // Lets the same file be picked again after an error.
              e.target.value = '';
            }}
          />
          {file ? (
            <>
              <p className="flex items-center gap-2 text-sm font-medium">
                <FileTextIcon className="size-5 text-primary" />
                <span className="break-all">{file.name}</span>
                <span className="font-normal text-muted-foreground">{formatSize(file.size)}</span>
              </p>
              <Button type="button" variant="link" size="sm" disabled={busy} onClick={() => input.current?.click()}>
                Choose another file
              </Button>
            </>
          ) : (
            <>
              <UploadIcon className="size-6 text-muted-foreground" />
              <p className="text-sm">
                Drop your CV here, or{' '}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 align-baseline underline underline-offset-4"
                  onClick={() => input.current?.click()}
                >
                  choose a file
                </Button>
              </p>
              <p className="text-xs text-muted-foreground">PDF, Word (.docx), .txt or .md, up to 10 MB</p>
            </>
          )}
        </div>
      </CardContent>
      {(file || error) && (
        <CardFooter className="flex flex-col items-stretch gap-3">
          {error && <ErrorAlert>{error}</ErrorAlert>}
          {/* Shown once a file is chosen: the analysis starts only on this click. */}
          {file && (
            <Button type="button" size="lg" disabled={busy} onClick={analyse}>
              <SparklesIcon />
              Analyse CV
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
