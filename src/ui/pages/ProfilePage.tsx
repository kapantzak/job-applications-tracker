import { startTransition, useRef, useState } from 'react';
import { SparklesIcon, TriangleAlertIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CvAnalysis, Profile } from '../../server/domain/types.js';
import { ApiError, updateProfile, type ProfileInput } from '../api/client.js';
import { CvReviewSheet } from '../components/CvReviewSheet.js';
import { PageHeader } from '../components/PageHeader.js';
import { ProfileCvCard } from '../components/ProfileCvCard.js';
import { ProfileForm, toProfileInput, type ProfileFormHandle } from '../components/ProfileForm.js';
import { useCvAnalysis } from '../hooks/use-cv-analysis.js';
import { profilePath, useCurrentProfile, useProfileShell } from '../profile-route.js';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Edits the current profile; creating one lives on the profiles screen.
export function ProfilePage() {
  const profile = useCurrentProfile();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Profile" description="What you are looking for. Discovery runs use this to search." />
      {/* A new profile starts with its own form, CV analysis and review state. */}
      <ProfileEditor key={profile.id} profile={profile} />
    </div>
  );
}

function ProfileEditor({ profile }: { profile: Profile }) {
  const { profileChanged } = useProfileShell();
  const navigate = useNavigate();
  const cv = useCvAnalysis(profile.id);
  const form = useRef<ProfileFormHandle>(null);
  // The review panel (SOW-0024, decision 33) and the form values it compares with.
  const [review, setReview] = useState<{ analysis: CvAnalysis; form: ProfileInput } | null>(null);
  // The analysis whose choices are in the form; Save sends it so the server also replaces the CV.
  const [appliedFrom, setAppliedFrom] = useState<{ id: string; fileName: string } | null>(null);
  // Only while it still exists: discarded here or in another tab, Save goes back to a plain save.
  const applied = appliedFrom !== null && cv.analysis?.id === appliedFrom.id ? cv.analysis : null;
  // The applied values outlived their analysis: they are still in the form, without the new CV (decision 39).
  const orphaned = appliedFrom !== null && cv.loaded && cv.analysis?.id !== appliedFrom.id;

  return (
    <>
      <ProfileCvCard
        profile={profile}
        onChange={profileChanged}
        cv={cv}
        onReview={(analysis) => {
          const values = form.current?.values();
          if (values) setReview({ analysis, form: values });
        }}
      />
      <CvReviewSheet
        analysis={review?.analysis ?? null}
        mode={profile.cv ? 'replace' : 'add'}
        form={review?.form ?? null}
        onClose={() => setReview(null)}
        onApply={(next) => {
          form.current?.apply(next);
          if (review) setAppliedFrom({ id: review.analysis.id, fileName: review.analysis.file_name });
          setReview(null);
        }}
      />
      {applied && (
        <Alert className="mb-4">
          <SparklesIcon />
          <AlertDescription>
            {profile.cv
              ? `The changes you chose from ${applied.file_name} are in the form. Save to keep them and replace your CV with this file.`
              : `The values you chose from ${applied.file_name} are in the form. Save to keep them and add this CV to the profile.`}
          </AlertDescription>
        </Alert>
      )}
      {orphaned && (
        <Alert className="mb-4">
          <TriangleAlertIcon />
          <AlertDescription>
            {`The CV analysis of ${appliedFrom.fileName} was discarded. The values you applied from it are still in the form: Save keeps them without the new CV, or reload the page to drop them.`}
          </AlertDescription>
        </Alert>
      )}
      <ProfileForm
        ref={form}
        initial={toProfileInput(profile)}
        submitLabel="Save"
        successMessage="Saved"
        onSubmit={async (input) => {
          let updated: Profile;
          try {
            updated = await updateProfile(profile.id, input, applied?.id);
          } catch (e) {
            // 409 may mean the analysis changed elsewhere; re-reading drops a stale one from the Save.
            if (applied && e instanceof ApiError && e.status === 409) void cv.refresh();
            throw e;
          }
          // The applied values are saved now, with the new CV or (after a discard) without it.
          setAppliedFrom(null);
          // The server deleted the analysis with the Save.
          if (applied) cv.set(null);
          // The slug follows the name. React Router applies navigation in a transition; putting the shell
          // update in the same transition makes the new URL and the new profile commit together, so the
          // page never sees a mismatch, shows no loading state and keeps its "Saved" message.
          startTransition(() => {
            if (updated.slug !== profile.slug) navigate(profilePath(updated.slug, '/profile'), { replace: true });
            profileChanged(updated);
          });
        }}
      />
    </>
  );
}
