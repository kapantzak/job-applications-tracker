import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { getAdapters, getProfile, getSettings } from './api/client.js';
import { Layout } from './components/Layout.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { SetupPage } from './pages/SetupPage.js';

function Placeholder({ name }: { name: string }) {
  return <h1>{name}</h1>;
}

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
  return <Placeholder name="Dashboard" />;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<StartupRedirect />} />
        <Route path="jobs" element={<Placeholder name="Jobs" />} />
        <Route path="applications" element={<Placeholder name="Applications" />} />
        <Route path="review" element={<Placeholder name="Review" />} />
        <Route path="runs" element={<Placeholder name="Runs" />} />
        <Route path="settings" element={<Placeholder name="Settings" />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  );
}
