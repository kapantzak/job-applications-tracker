import { useState } from 'react';
import { DownloadIcon, FilePlusIcon, FileTextIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import type { CvAnalysis, Profile } from '../../server/domain/types.js';
import { profileCvUrl, removeProfileCv } from '../api/client.js';
import { formatTime } from '../format.js';
import type { useCvAnalysis } from '../hooks/use-cv-analysis.js';
import { CvAnalysisCard } from './CvAnalysisCard.js';
import { CvUploadCard } from './CvUploadCard.js';
import { ErrorAlert } from './feedback.js';
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
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface ProfileCvCardProps {
  profile: Profile;
  onChange: (updated: Profile) => void;
  // The profile's own CV analysis (SOW-0024), owned by the page so Save can end it.
  cv: ReturnType<typeof useCvAnalysis>;
  onReview: (analysis: CvAnalysis) => void;
}

// The CV kept with the profile (SOW-0023, decisions 11 and 21), Replace CV and Add CV, and the profile's
// CV analysis while it runs or waits for review (SOW-0024).
export function ProfileCvCard({ profile, onChange, cv, onReview }: ProfileCvCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const analysis = cv.analysis;

  // One analysis per profile: Replace CV and Add CV come back once it is saved or discarded.
  const uploadButton =
    cv.loaded && !analysis && !uploading ? (
      <Button type="button" variant="outline" size="sm" onClick={() => setUploading(true)}>
        {profile.cv ? <RefreshCwIcon /> : <FilePlusIcon />}
        {profile.cv ? 'Replace CV' : 'Add CV'}
      </Button>
    ) : null;

  const below = analysis ? (
    <CvAnalysisCard
      analysis={analysis}
      onChange={cv.set}
      onReview={() => onReview(analysis)}
      onStale={() => void cv.refresh()}
    />
  ) : uploading ? (
    <CvUploadCard
      profile={{ id: profile.id, hasCv: profile.cv !== null }}
      onStarted={(started) => {
        setUploading(false);
        cv.set(started);
      }}
      onStale={() => {
        setUploading(false);
        void cv.refresh();
      }}
      onCancel={() => setUploading(false)}
    />
  ) : null;

  if (!profile.cv) {
    return (
      <div className="mb-6 flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileTextIcon className="size-5 text-muted-foreground" />
              <h2>CV</h2>
            </CardTitle>
            <CardDescription>No CV yet. Add one and AI suggests values for the fields left empty.</CardDescription>
            {uploadButton && <CardAction>{uploadButton}</CardAction>}
          </CardHeader>
        </Card>
        {below}
      </div>
    );
  }

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await removeProfileCv(profile.id));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileTextIcon className="size-5 text-primary" />
            <h2>CV</h2>
          </CardTitle>
          <CardDescription>
            <span className="break-all">{profile.cv.file_name}</span> · added {formatTime(profile.cv.added_at)}
          </CardDescription>
          <CardAction className="flex flex-wrap gap-2">
            {uploadButton}
            <Button asChild variant="outline" size="sm">
              <a href={profileCvUrl(profile.id)} download={profile.cv.file_name}>
                <DownloadIcon />
                Download
              </a>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm" disabled={busy}>
                  <Trash2Icon />
                  Remove CV
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove the CV?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The file and the text read from it are deleted. The profile and its fields stay as they are.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep the CV</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={remove}>
                    Remove CV
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardAction>
        </CardHeader>
        {error && <ErrorAlert className="mx-6 w-auto">{error}</ErrorAlert>}
      </Card>
      {below}
    </div>
  );
}
