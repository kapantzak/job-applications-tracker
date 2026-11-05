import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { listProposals } from '../api/client.js';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/jobs', label: 'Jobs' },
  { to: '/applications', label: 'Applications' },
  { to: '/review', label: 'Review', badge: true },
  { to: '/runs', label: 'Runs' },
  { to: '/settings', label: 'Settings' },
  { to: '/profile', label: 'Profile' },
];

export function Layout() {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let active = true;
    listProposals()
      .then((proposals) => {
        if (active) setPending(proposals.length);
      })
      // The badge is decorative; a failed fetch must not break the shell.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="layout">
      <nav className="nav" aria-label="Main">
        <div className="brand">Job Tracker</div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
            {item.label}
            {item.badge && pending > 0 && <span className="badge">{pending}</span>}
          </NavLink>
        ))}
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
