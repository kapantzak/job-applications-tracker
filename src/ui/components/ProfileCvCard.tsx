import { useState } from 'react';
import { DownloadIcon, FileTextIcon, Trash2Icon } from 'lucide-react';
import type { Profile } from '../../server/domain/types.js';
import { profileCvUrl, removeProfileCv } from '../api/client.js';
import { formatTime } from '../format.js';
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

// The CV kept with the profile (SOW-0023, decisions 11 and 21). Shown only when there is one; adding a
// CV to an existing profile is SOW-0024.
export function ProfileCvCard({ profile, onChange }: { profile: Profile; onChange: (updated: Profile) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!profile.cv) return null;

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
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileTextIcon className="size-5 text-primary" />
          <h2>CV</h2>
        </CardTitle>
        <CardDescription>
          <span className="break-all">{profile.cv.file_name}</span> · added {formatTime(profile.cv.added_at)}
        </CardDescription>
        <CardAction className="flex flex-wrap gap-2">
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
  );
}
