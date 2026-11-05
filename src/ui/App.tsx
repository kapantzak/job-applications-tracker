import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';

function Placeholder({ name }: { name: string }) {
  return <h1>{name}</h1>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Placeholder name="Dashboard" />} />
        <Route path="jobs" element={<Placeholder name="Jobs" />} />
        <Route path="applications" element={<Placeholder name="Applications" />} />
        <Route path="review" element={<Placeholder name="Review" />} />
        <Route path="runs" element={<Placeholder name="Runs" />} />
        <Route path="settings" element={<Placeholder name="Settings" />} />
        <Route path="profile" element={<Placeholder name="Profile" />} />
      </Route>
    </Routes>
  );
}
