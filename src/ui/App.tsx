import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { getAdapters, getProfile, getSettings } from './api/client.js';
import { Layout } from './components/Layout.js';
import { ApplicationDetailPage } from './pages/ApplicationDetailPage.js';
import { ApplicationsPage } from './pages/ApplicationsPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { JobsPage } from './pages/JobsPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { ReviewPage } from './pages/ReviewPage.js';
import { RunPage } from './pages/RunPage.js';
import { RunsPage } from './pages/RunsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { SetupPage } from './pages/SetupPage.js';

// Only guards the root route; every other page stays directly reachable.
function StartupRedirect() {
  const [target, setTarget] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      const [settings, adapters] = await Promise.all([getSettings(), getAdapters()]);
      const chosen = adapters.find((a) => a.id === settings.adapter_id);
      if (!chosen?.installed) return '/setup';
      return (await getProfile()) === null ? '/profile' : null;
    })()
      // On failure fall through to the dashboard rather than trapping the user.
      .catch(() => null)
      .then((next) => {
        if (active) setTarget(next);
      });
    return () => {
      active = false;
    };
  }, []);

  if (target === undefined) return <p>Loading...</p>;
  if (target) return <Navigate to={target} replace />;
  return <DashboardPage />;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<StartupRedirect />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="applications/:id" element={<ApplicationDetailPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<RunPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  );
}
