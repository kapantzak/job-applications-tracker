import { useEffect, useState } from 'react';
import {
  BriefcaseIcon,
  FileTextIcon,
  HistoryIcon,
  InboxIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  UserIcon,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, matchPath } from 'react-router-dom';
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
import { listProposals } from '../api/client.js';
import { ThemeMenu } from './ThemeMenu.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon, end: true },
  { to: '/jobs', label: 'Jobs', icon: BriefcaseIcon },
  { to: '/applications', label: 'Applications', icon: FileTextIcon },
  { to: '/review', label: 'Review', icon: InboxIcon, badge: true },
  { to: '/runs', label: 'Runs', icon: HistoryIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
  { to: '/profile', label: 'Profile', icon: UserIcon },
];

export function Layout() {
  const { pathname } = useLocation();
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
          <SidebarGroup>
            <SidebarGroupContent>
              <nav aria-label="Main">
                <SidebarMenu>
                  {NAV.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={!!matchPath({ path: item.to, end: item.end ?? false }, pathname)}
                      >
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
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
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
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
