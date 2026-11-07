import { startTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import { updateProfile } from '../api/client.js';
import { PageHeader } from '../components/PageHeader.js';
import { ProfileCvCard } from '../components/ProfileCvCard.js';
import { ProfileForm, toProfileInput } from '../components/ProfileForm.js';
import { profilePath, useCurrentProfile, useProfileShell } from '../profile-route.js';

// Edits the current profile; creating one lives on the profiles screen.
export function ProfilePage() {
  const profile = useCurrentProfile();
  const { profileChanged } = useProfileShell();
  const navigate = useNavigate();

  return (
    <div className="max-w-2xl">
      <PageHeader title="Profile" description="What you are looking for. Discovery runs use this to search." />
      <ProfileCvCard profile={profile} onChange={profileChanged} />
      <ProfileForm
        key={profile.id}
        initial={toProfileInput(profile)}
        submitLabel="Save"
        successMessage="Saved"
        onSubmit={async (input) => {
          const updated = await updateProfile(profile.id, input);
          // The slug follows the name. React Router applies navigation in a transition; putting the shell
          // update in the same transition makes the new URL and the new profile commit together, so the
          // page never sees a mismatch, shows no loading state and keeps its "Saved" message.
          startTransition(() => {
            if (updated.slug !== profile.slug) navigate(profilePath(updated.slug, '/profile'), { replace: true });
            profileChanged(updated);
          });
        }}
      />
    </div>
  );
}
