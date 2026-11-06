import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  ArrowLeftIcon,
  BriefcaseIcon,
  FileTextIcon,
  HistoryIcon,
  InboxIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, matchPath } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { getProfile, listProposals } from '../api/client.js';
import { profilePath, ProfileShellContext } from '../profile-route.js';
import { ThemeMenu } from './ThemeMenu.js';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType;
  end?: boolean;
  badge?: boolean;
}

const GLOBAL_NAV: NavItem[] = [
  { to: '/', label: 'Profiles', icon: UsersIcon, end: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function profileNav(profileId: string): NavItem[] {
  return [
    { to: profilePath(profileId), label: 'Dashboard', icon: LayoutDashboardIcon, end: true },
    { to: profilePath(profileId, '/jobs'), label: 'Jobs', icon: BriefcaseIcon },
    { to: profilePath(profileId, '/applications'), label: 'Applications', icon: FileTextIcon },
    { to: profilePath(profileId, '/review'), label: 'Review', icon: InboxIcon, badge: true },
    { to: profilePath(profileId, '/runs'), label: 'Runs', icon: HistoryIcon },
    { to: profilePath(profileId, '/profile'), label: 'Profile', icon: UserIcon },
  ];
}

// The profile the URL is inside, if any; /profiles/new is the create form, not a profile.
function currentProfileId(pathname: string): string | null {
  if (matchPath({ path: '/profiles/new', end: true }, pathname)) return null;
  return matchPath({ path: '/profiles/:profileId/*' }, pathname)?.params.profileId ?? null;
}

function NavMenu({ items, pathname, pending }: { items: NavItem[]; pathname: string; pending: number }) {
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton asChild isActive={!!matchPath({ path: item.to, end: item.end ?? false }, pathname)}>
            <NavLink to={item.to} end={item.end}>
              <item.icon />
              <span>
                {item.label}
                {/* The visible count is a sibling badge; repeat it here so the link name carries it. */}
                {item.badge && pending > 0 && <span className="sr-only">, {pending} pending</span>}
              </span>
            </NavLink>
          </SidebarMenuButton>
          {item.badge && pending > 0 && (
            <SidebarMenuBadge
              // Keep white text on red; the sidebar's hover/active text colours would otherwise win.
              className="bg-destructive text-white peer-hover/menu-button:text-white peer-data-[active=true]/menu-button:text-white"
            >
              {pending}
            </SidebarMenuBadge>
          )}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const profileId = currentProfileId(pathname);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [version, setVersion] = useState(0);

  // Never show one profile's name or count while another one loads.
  useEffect(() => {
    setProfileName(null);
    setPending(0);
  }, [profileId]);

  // Re-read on navigation too, so the badge and name follow decisions and edits made on the pages.
  useEffect(() => {
    if (!profileId) return;
    let active = true;
    getProfile(profileId)
      .then((profile) => {
        if (active) setProfileName(profile.name);
      })
      // A missing profile shows its error on the page; the sidebar just keeps a neutral label.
      .catch(() => {
        if (active) setProfileName(null);
      });
    listProposals(profileId)
      .then((proposals) => {
        if (active) setPending(proposals.length);
      })
      // The badge is decorative; a failed fetch must not break the shell.
      .catch(() => {
        if (active) setPending(0);
      });
    return () => {
      active = false;
    };
  }, [profileId, pathname, version]);

  const profileChanged = useCallback(() => setVersion((v) => v + 1), []);
  const shell = useMemo(() => ({ profileChanged }), [profileChanged]);

  return (
    // Desktop-only app (design section 3): the sidebar stays fixed and never collapses.
    <SidebarProvider>
      <Sidebar collapsible="none" className="sticky top-0 h-svh border-r">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BriefcaseIcon className="size-4" />
            </div>
            <span className="font-semibold">Job Tracker</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          {profileId ? (
            <>
              <SidebarGroup>
                <SidebarGroupLabel className="truncate" title={profileName ?? undefined}>
                  {profileName ?? 'Profile'}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <nav aria-label="Profile">
                    <NavMenu items={profileNav(profileId)} pathname={pathname} pending={pending} />
                  </nav>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupContent>
                  <nav aria-label="Main">
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <NavLink to="/" end>
                            <ArrowLeftIcon />
                            <span>Switch profile</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                    <NavMenu items={GLOBAL_NAV.slice(1)} pathname={pathname} pending={0} />
                  </nav>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          ) : (
            <SidebarGroup>
              <SidebarGroupContent>
                <nav aria-label="Main">
                  <NavMenu items={GLOBAL_NAV} pathname={pathname} pending={0} />
                </nav>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <ThemeMenu />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <div className="mx-auto w-full max-w-6xl flex-1 px-8 py-6">
          <ProfileShellContext.Provider value={shell}>
            <Outlet />
          </ProfileShellContext.Provider>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
