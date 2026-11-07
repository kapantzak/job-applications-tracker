import { useCallback, useEffect, useState } from 'react';
import { ArrowRightIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProfileCounts, ProfileListItem } from '../../server/domain/types.js';
import { deleteProfile, listProfiles } from '../api/client.js';
import { CreateProfileFlow, type CreateProfileLocationState } from '../components/CreateProfileFlow.js';
import { CvAnalysisCard } from '../components/CvAnalysisCard.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { useCvAnalysis } from '../hooks/use-cv-analysis.js';
import { profilePath } from '../profile-route.js';
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
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function countsText({ jobs, applications, runs }: ProfileCounts): string {
  return `${plural(jobs, 'job')}, ${plural(applications, 'application')} and ${plural(runs, 'run')}`;
}

export function NewProfilePage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="New profile" description="A separate search with its own jobs, applications and runs." />
      <CreateProfileFlow />
    </div>
  );
}

// A CV analysis started earlier is shown above the list (SOW-0023, decision 23).
function PendingCvAnalysis() {
  const navigate = useNavigate();
  const cv = useCvAnalysis();
  if (!cv.analysis) return null;
  const review: CreateProfileLocationState = { review: true };
  return (
    <div className="mb-6 max-w-4xl">
      <CvAnalysisCard
        analysis={cv.analysis}
        onChange={cv.set}
        onReview={() => navigate('/profiles/new', { state: review })}
        onStale={() => void cv.refresh()}
      />
    </div>
  );
}

function DeleteProfileButton({ profile, onDeleted }: { profile: ProfileListItem; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteProfile(profile.id);
      onDeleted();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" size="sm" disabled={busy} aria-label={`Delete ${profile.name}`}>
            <Trash2Icon />
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {profile.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the profile{profile.cv ? ', its CV' : ''} and its {countsText(profile.counts)}, with their
              proposals, status history and run logs. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirm}>
              Delete profile
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && <ErrorAlert>{error}</ErrorAlert>}
    </div>
  );
}

// The start screen: every profile, or the profile form when there is none yet.
export function ProfilesPage() {
  const [profiles, setProfiles] = useState<ProfileListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((isActive: () => boolean = () => true) => {
    listProfiles()
      .then((list) => {
        if (isActive()) setProfiles(list);
      })
      .catch((e: unknown) => {
        if (isActive()) setError(message(e));
      });
  }, []);

  useEffect(() => {
    let active = true;
    load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  if (!profiles) return error ? <ErrorAlert>{error}</ErrorAlert> : <LoadingState />;

  if (profiles.length === 0) {
    return (
      <div className="max-w-4xl">
        <PageHeader
          title="Create your first profile"
          description="Describe the jobs you are looking for. You can add more profiles for other searches later."
        />
        <CreateProfileFlow />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Profiles"
        description="Each profile keeps its own jobs, applications and runs. Settings are shared."
        actions={
          <Button asChild>
            <Link to="/profiles/new">
              <PlusIcon />
              New profile
            </Link>
          </Button>
        }
      />
      <PendingCvAnalysis />
      <ul className="grid gap-4 sm:grid-cols-2" aria-label="Profiles">
        {profiles.map((p) => (
          <li key={p.id}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>
                  <h2>
                    <Link to={profilePath(p.slug)} className="hover:underline">
                      {p.name}
                    </Link>
                  </h2>
                </CardTitle>
                <CardDescription>{p.target_roles.join(', ') || 'No target roles'}</CardDescription>
                <CardAction>
                  <DeleteProfileButton profile={p} onDeleted={() => load()} />
                </CardAction>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{countsText(p.counts)}</CardContent>
              <CardFooter className="mt-auto gap-2">
                <Button asChild size="sm">
                  <Link to={profilePath(p.slug)} aria-label={`Open ${p.name}`}>
                    Open
                    <ArrowRightIcon />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to={profilePath(p.slug, '/profile')} aria-label={`Edit ${p.name}`}>
                    <PencilIcon />
                    Edit
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
