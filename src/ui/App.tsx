import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { getAdapters, getSettings } from './api/client.js';
import { Layout } from './components/Layout.js';
import { ApplicationDetailPage } from './pages/ApplicationDetailPage.js';
import { ApplicationsPage } from './pages/ApplicationsPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { JobsPage } from './pages/JobsPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { NewProfilePage, ProfilesPage } from './pages/ProfilesPage.js';
import { ReviewPage } from './pages/ReviewPage.js';
import { RunPage } from './pages/RunPage.js';
import { RunsPage } from './pages/RunsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { SetupPage } from './pages/SetupPage.js';
import { useProfileId } from './profile-route.js';

// Runs once per page load. `/` is also the profiles hub (sidebar, Setup's continue link), so checking on
// every visit would trap a user whose agent is missing on Setup with no way back to their profiles.
let startupChecked = false;

// The root is the profiles screen, which shows the profile form itself when there is no profile yet.
// On first load it sends the user to Setup when the chosen agent is not installed.
function StartupRedirect() {
  const [target, setTarget] = useState<string | null | undefined>(startupChecked ? null : undefined);

  useEffect(() => {
    if (startupChecked) return;
    let active = true;
    (async () => {
      const [settings, adapters] = await Promise.all([getSettings(), getAdapters()]);
      const chosen = adapters.find((a) => a.id === settings.adapter_id);
      return chosen?.installed ? null : '/setup';
    })()
      // On failure fall through to the profiles screen rather than trapping the user.
      .catch(() => null)
      .then((next) => {
        if (!active) return;
        startupChecked = true;
        setTarget(next);
      });
    return () => {
      active = false;
    };
  }, []);

  if (target === undefined) return <p>Loading...</p>;
  if (target) return <Navigate to={target} replace />;
  return <ProfilesPage />;
}

// Remounts the profile's pages when the URL moves to another profile, so no page keeps showing (or
// polling) the previous profile's data.
function ProfileScope() {
  const profileId = useProfileId();
  return <Outlet key={profileId} />;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<StartupRedirect />} />
        <Route path="profiles/new" element={<NewProfilePage />} />
        {/* Everything a profile owns lives under its id (SOW-0014). */}
        <Route path="profiles/:profileId" element={<ProfileScope />}>
          <Route index element={<DashboardPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="applications" element={<ApplicationsPage />} />
          <Route path="applications/:id" element={<ApplicationDetailPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:id" element={<RunPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="setup" element={<SetupPage />} />
        {/* Old single-profile links (/jobs, /profile, ...) and unknown paths land on the profiles screen. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
