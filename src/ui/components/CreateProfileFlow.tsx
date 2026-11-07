import { useState } from 'react';
import { ArrowLeftIcon, PencilLineIcon, SparklesIcon } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, createProfile } from '../api/client.js';
import { useCvAnalysis } from '../hooks/use-cv-analysis.js';
import { profilePath } from '../profile-route.js';
import { CvAnalysisCard } from './CvAnalysisCard.js';
import { CvUploadCard } from './CvUploadCard.js';
import { ErrorAlert, LoadingState } from './feedback.js';
import { EMPTY_PROFILE, ProfileForm } from './ProfileForm.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

type Mode = 'choose' | 'manual' | 'review';

// Set by the Profiles screen's "Review and create", so the review opens without a second click.
export interface CreateProfileLocationState {
  review?: boolean;
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onClick}>
      <ArrowLeftIcon />
      Back
    </Button>
  );
}

// Creates a profile from a CV or by hand (SOW-0023); used by the first-run screen and by New profile.
export function CreateProfileFlow() {
  const navigate = useNavigate();
  const location = useLocation();
  const cv = useCvAnalysis();
  const [mode, setMode] = useState<Mode>(() =>
    (location.state as CreateProfileLocationState | null)?.review ? 'review' : 'choose',
  );

  if (!cv.loaded) return cv.error ? <ErrorAlert>{cv.error}</ErrorAlert> : <LoadingState />;
  const analysis = cv.analysis;

  if (mode === 'manual') {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <BackButton onClick={() => setMode('choose')} />
        <ProfileForm
          initial={EMPTY_PROFILE}
          submitLabel="Create profile"
          onSubmit={async (input) => {
            const created = await createProfile(input);
            navigate(profilePath(created.slug));
          }}
        />
      </div>
    );
  }

  // Falls back to the choice when the analysis is gone, e.g. discarded in another tab.
  if (mode === 'review' && analysis?.status === 'succeeded' && analysis.draft) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <BackButton onClick={() => setMode('choose')} />
        <Alert>
          <SparklesIcon />
          <AlertDescription>
            Suggested by AI from {analysis.file_name}. Check every field, then create the profile; the CV is kept with
            it.
          </AlertDescription>
        </Alert>
        <ProfileForm
          initial={{ ...EMPTY_PROFILE, ...analysis.draft }}
          submitLabel="Create profile"
          onSubmit={async (input) => {
            try {
              const created = await createProfile(input, analysis.id);
              navigate(profilePath(created.slug));
            } catch (e) {
              // A 409 is a taken name or an analysis changed elsewhere; re-reading returns to the choice
              // in the second case and keeps the form in the first.
              if (e instanceof ApiError && e.status === 409) void cv.refresh();
              throw e;
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-5">
      <div className="md:col-span-3">
        {analysis ? (
          <CvAnalysisCard
            analysis={analysis}
            onChange={cv.set}
            onReview={() => setMode('review')}
            onStale={() => void cv.refresh()}
          />
        ) : (
          <CvUploadCard onStarted={cv.set} onStale={() => void cv.refresh()} />
        )}
      </div>
      <Card className="md:col-span-2">
        <CardHeader className="gap-2">
          <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <PencilLineIcon className="size-5" />
          </div>
          <CardTitle>
            <h2>Fill in by hand</h2>
          </CardTitle>
          <CardDescription>Type your target roles, locations and keywords yourself.</CardDescription>
        </CardHeader>
        <CardFooter className="mt-auto">
          <Button type="button" variant="outline" onClick={() => setMode('manual')}>
            Open the form
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
