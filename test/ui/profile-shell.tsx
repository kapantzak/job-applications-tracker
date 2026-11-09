import type { ReactNode } from 'react';
import type { Profile } from '../../src/server/domain/types.js';
import { ProfileShellContext } from '../../src/ui/profile-route.js';

// Id and slug differ on purpose: data calls take the id, links carry the slug (SOW-0015).
export const TEST_PROFILE: Profile = {
  id: 'pf1',
  name: 'Platform roles',
  slug: 'platform-roles',
  target_roles: ['Engineer'],
  locations: [],
  remote: 'any',
  seniority: '',
  keywords: [],
  excluded_companies: [],
  notes: '',
  mail_filter_kind: 'label',
  mail_filter: '',
  cv: null,
  created_at: '2026-11-01T00:00:00.000Z',
};

// Stands in for the shell (Layout), which resolves the URL slug for pages in the app.
export function InProfile({
  children,
  profile = TEST_PROFILE,
  profileChanged = () => {},
}: {
  children: ReactNode;
  profile?: Profile;
  profileChanged?: (updated?: Profile) => void;
}) {
  return (
    <ProfileShellContext.Provider value={{ status: 'ready', profile, error: null, profileChanged }}>
      {children}
    </ProfileShellContext.Provider>
  );
}
