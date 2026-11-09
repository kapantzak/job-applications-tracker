import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
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
import { Link, NavLink, Outlet, useLocation, matchPath } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import type { Profile } from '../../server/domain/types.js';
import { ApiError, getProfileBySlug, listProposals } from '../api/client.js';
import { profilePath, ProfileShellContext, type ProfileShell } from '../profile-route.js';
import { HelpMenu } from './HelpMenu.js';
import { LogoMark } from './LogoMark.js';
import { ThemeMenu } from './ThemeMenu.js';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType;
  end?: boolean;
  badge?: boolean;
}

const PROFILES_ITEM: NavItem = { to: '/', label: 'Profiles', icon: UsersIcon, end: true };
const SETTINGS_ITEM: NavItem = { to: '/settings', label: 'Settings', icon: SettingsIcon };

function profileNav(slug: string): NavItem[] {
  return [
    { to: profilePath(slug), label: 'Dashboard', icon: LayoutDashboardIcon, end: true },
    { to: profilePath(slug, '/jobs'), label: 'Jobs', icon: BriefcaseIcon },
    { to: profilePath(slug, '/applications'), label: 'Applications', icon: FileTextIcon },
    { to: profilePath(slug, '/review'), label: 'Review', icon: InboxIcon, badge: true },
    { to: profilePath(slug, '/runs'), label: 'Runs', icon: HistoryIcon },
    { to: profilePath(slug, '/profile'), label: 'Profile', icon: UserIcon },
  ];
}

// The profile slug the URL is inside, if any; /profiles/new is the create form, not a profile.
function currentProfileSlug(pathname: string): string | null {
  if (matchPath({ path: '/profiles/new', end: true }, pathname)) return null;
  const raw = matchPath({ path: '/profiles/:profileSlug/*' }, pathname)?.params.profileSlug;
  if (!raw) return null;
  // Browsers keep non-ASCII slugs percent-encoded in location.pathname.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

interface LookupFailure {
  slug: string;
  notFound: boolean;
  message: string;
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
  const slug = currentProfileSlug(pathname);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failure, setFailure] = useState<LookupFailure | null>(null);
  const [pending, setPending] = useState(0);
  const [version, setVersion] = useState(0);
  // A profile a page just handed over (rename), tied to the version it was handed over at: no lookup is
  // needed for that slug until something asks for a re-read.
  const adopted = useRef<{ slug: string; version: number } | null>(null);
  const versionRef = useRef(version);
  versionRef.current = version;

  // Resolve the URL slug once per profile (and again after a page reports a change).
  useEffect(() => {
    if (!slug) return;
    if (adopted.current && adopted.current.slug === slug && adopted.current.version === version) return;
    let active = true;
    getProfileBySlug(slug)
      .then((found) => {
        if (!active) return;
        setProfile(found);
        setFailure(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        const notFound = e instanceof ApiError && e.status === 404;
        // A held profile with this slug is stale (renamed or deleted elsewhere).
        if (notFound) setProfile((held) => (held && held.slug === slug ? null : held));
        setFailure({ slug, notFound, message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      active = false;
    };
  }, [slug, version]);

  // Derived, so a profile resolved for another slug is never shown as the current one.
  let status: ProfileShell['status'] = 'none';
  if (slug) {
    if (profile && profile.slug === slug) status = 'ready';
    else if (failure && failure.slug === slug) status = failure.notFound ? 'missing' : 'error';
    else status = 'loading';
  }
  const current = status === 'ready' ? profile : null;
  const currentId = current?.id ?? null;

  // Re-read on navigation too, so the badge follows decisions made on the pages.
  useEffect(() => {
    setPending(0);
    if (!currentId) return;
    let active = true;
    listProposals(currentId)
      .then((proposals) => {
        if (active) setPending(proposals.length);
      })
      // The badge is decorative; a failed fetch must not break the shell.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentId, pathname, version]);

  const profileChanged = useCallback((updated?: Profile) => {
    if (updated) {
      adopted.current = { slug: updated.slug, version: versionRef.current };
      setProfile(updated);
    } else {
      setVersion((v) => v + 1);
    }
  }, []);
  const shell = useMemo<ProfileShell>(
    () => ({
      status,
      profile: current,
      error: status === 'error' ? (failure?.message ?? null) : null,
      profileChanged,
    }),
    [status, current, failure, profileChanged],
  );

  return (
    // Desktop-only app (design section 3): the sidebar stays fixed and never collapses.
    <SidebarProvider>
      <Sidebar collapsible="none" className="sticky top-0 h-svh border-r">
        <SidebarHeader>
          {slug ? (
            // Inside a profile the header names it and leads back to all profiles (SOW-0015).
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="lg" title={current?.name}>
                  <Link to="/">
                    <ArrowLeftIcon />
                    <span className="font-semibold">
                      <span className="sr-only">Back to profiles:</span> {current?.name ?? 'Profile'}
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <LogoMark className="size-5" data-testid="app-logo" />
              </div>
              <span className="font-semibold">Job Tracker</span>
            </div>
          )}
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              {slug ? (
                <>
                  <nav aria-label="Profile">
                    <NavMenu items={profileNav(slug)} pathname={pathname} pending={pending} />
                  </nav>
                  <nav aria-label="Main" className="mt-4">
                    <NavMenu items={[SETTINGS_ITEM]} pathname={pathname} pending={0} />
                  </nav>
                </>
              ) : (
                <nav aria-label="Main">
                  <NavMenu items={[PROFILES_ITEM, SETTINGS_ITEM]} pathname={pathname} pending={0} />
                </nav>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <HelpMenu />
            </SidebarMenuItem>
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
