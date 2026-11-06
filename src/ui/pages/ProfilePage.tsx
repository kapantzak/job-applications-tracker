import { useEffect, useState } from 'react';
import { getProfile, updateProfile, type ProfileInput } from '../api/client.js';
import { ErrorAlert, LoadingState } from '../components/feedback.js';
import { PageHeader } from '../components/PageHeader.js';
import { ProfileForm, toProfileInput } from '../components/ProfileForm.js';
import { useProfileId, useProfileShell } from '../profile-route.js';

// Edits the profile the URL names; creating one lives on the profiles screen.
export function ProfilePage() {
  const profileId = useProfileId();
  const { profileChanged } = useProfileShell();
  const [initial, setInitial] = useState<ProfileInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setInitial(null);
    setError(null);
    getProfile(profileId)
      .then((profile) => {
        if (active) setInitial(toProfileInput(profile));
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  if (!initial) return error ? <ErrorAlert>{error}</ErrorAlert> : <LoadingState />;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Profile" description="What you are looking for. Discovery runs use this to search." />
      <ProfileForm
        key={profileId}
        initial={initial}
        submitLabel="Save"
        successMessage="Saved"
        onSubmit={async (input) => {
          await updateProfile(profileId, input);
          profileChanged();
        }}
      />
    </div>
  );
}
