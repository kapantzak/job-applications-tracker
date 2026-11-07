import { createContext, useContext } from 'react';
import type { Profile } from '../server/domain/types.js';

// URLs name a profile by slug; data calls use its id (SOW-0015). The shell (Layout) resolves the slug
// once and shares the profile with every page below it.
export interface ProfileShell {
  // none: not inside a profile; loading: slug being resolved; missing: no profile has this slug;
  // error: the lookup failed for another reason (message in `error`).
  status: 'none' | 'loading' | 'ready' | 'missing' | 'error';
  profile: Profile | null;
  error: string | null;
  // Pages call this after changing the profile. With the saved profile it updates at once (a rename
  // changes the slug); without one the shell re-reads it.
  profileChanged: (updated?: Profile) => void;
}

export const ProfileShellContext = createContext<ProfileShell>({
  status: 'none',
  profile: null,
  error: null,
  profileChanged: () => {},
});

export function useProfileShell(): ProfileShell {
  return useContext(ProfileShellContext);
}

export function useCurrentProfile(): Profile {
  const { profile } = useProfileShell();
  if (!profile) throw new Error('useCurrentProfile used outside a resolved /profiles/:profileSlug route');
  return profile;
}

export function useProfileId(): string {
  return useCurrentProfile().id;
}

export const profilePath = (slug: string, path = ''): string => `/profiles/${encodeURIComponent(slug)}${path}`;

// Links inside the current profile.
export function useProfileHref(): (path?: string) => string {
  const { slug } = useCurrentProfile();
  return (path = '') => profilePath(slug, path);
}
