import { createContext, useContext } from 'react';
import { useParams } from 'react-router-dom';

// Every page under /profiles/:profileId reads its profile from the URL (SOW-0014).
export function useProfileId(): string {
  const { profileId } = useParams();
  if (!profileId) throw new Error('useProfileId used outside a /profiles/:profileId route');
  return profileId;
}

export const profilePath = (profileId: string, path = ''): string => `/profiles/${encodeURIComponent(profileId)}${path}`;

// Lets a page tell the shell that the current profile changed (e.g. renamed), so the sidebar re-reads it.
export const ProfileShellContext = createContext<{ profileChanged: () => void }>({ profileChanged: () => {} });

export function useProfileShell() {
  return useContext(ProfileShellContext);
}
