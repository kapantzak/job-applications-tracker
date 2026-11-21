import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from '../../src/ui/components/Layout.js';
import * as client from '../../src/ui/api/client.js';
import { useProfileShell } from '../../src/ui/profile-route.js';
import { TEST_PROFILE } from './profile-shell.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listProposals: vi.fn(),
  listApplicationProposals: vi.fn(),
  getProfileBySlug: vi.fn(),
  getHealth: vi.fn(),
  getUpdate: vi.fn(),
}));

// Shows what the shell resolved, and lets the test report a change the way pages do.
function ShellProbe() {
  const { status, profile, profileChanged } = useProfileShell();
  return (
    <>
      <p data-testid="shell">{`${status}:${profile?.id ?? '-'}`}</p>
      <button type="button" onClick={() => profileChanged()}>
        reload
      </button>
      <button type="button" onClick={() => profileChanged({ ...TEST_PROFILE, name: 'Lead roles' })}>
        rename
      </button>
    </>
  );
}

function renderShell(path = '/profiles/platform-roles/review') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>profiles page</p>} />
          <Route path="profiles/new" element={<p>new profile page</p>} />
          <Route path="profiles/:profileSlug/*" element={<ShellProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  document.documentElement.className = '';
  vi.mocked(client.listProposals).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);
  vi.mocked(client.listApplicationProposals).mockResolvedValue([{ id: 'n1' }] as never);
  vi.mocked(client.getProfileBySlug).mockResolvedValue(TEST_PROFILE);
  vi.mocked(client.getHealth).mockResolvedValue({ ok: true, version: '9.9.9', dataDir: '/data' });
  vi.mocked(client.getUpdate).mockResolvedValue({ current: '9.9.9', latest: '9.9.9', available: false });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.cookie = 'sidebar_state=; max-age=0; path=/';
});

describe('Layout', () => {
  it("inside a profile, resolves the slug and shows the profile's pages and its pending count", async () => {
    renderShell();
    // The probe renders "loading:-" first, so wait for its text rather than for the element.
    await waitFor(() => expect(screen.getByTestId('shell')).toHaveTextContent('ready:pf1'));
    expect(client.getProfileBySlug).toHaveBeenCalledWith('platform-roles');
    // Status changes and new applications (SOW-0045) both wait on the Review page.
    const review = await screen.findByRole('link', { name: 'Review, 3 pending' });
    expect(client.listProposals).toHaveBeenCalledWith('pf1');
    expect(client.listApplicationProposals).toHaveBeenCalledWith('pf1');
    expect(review).toHaveAttribute('href', '/profiles/platform-roles/review');
    expect(review).toHaveAttribute('aria-current', 'page');
    const nav = screen.getByRole('navigation', { name: 'Profile' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/profiles/platform-roles');
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(within(main).getAllByRole('link').map((l) => l.textContent)).toEqual(['Settings']);
    expect(screen.queryByText('Switch profile')).not.toBeInTheDocument();
  });

  it('puts the profile name in the header as a back link to the profiles screen, with the full name on hover', async () => {
    const long = { ...TEST_PROFILE, name: 'A very long profile name that will not fit in the sidebar header' };
    vi.mocked(client.getProfileBySlug).mockResolvedValue(long);
    renderShell();
    const back = await screen.findByRole('link', { name: `Back to profiles: ${long.name}` });
    expect(back).toHaveAttribute('href', '/');
    expect(back).toHaveAttribute('title', long.name);
    // The name is the button's last span, which the sidebar button truncates with an ellipsis.
    expect(back.lastElementChild?.tagName).toBe('SPAN');
    expect(back.lastElementChild).toHaveTextContent(long.name);
    expect(screen.queryByText('Job Tracker')).not.toBeInTheDocument();
  });

  it.each(['/', '/profiles/new'])('at %s, shows the app name, only Profiles and Settings, and fetches nothing', async (path) => {
    renderShell(path);
    expect(screen.getByText('Job Tracker')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Profiles', 'Settings']);
    expect(screen.queryByRole('navigation', { name: 'Profile' })).not.toBeInTheDocument();
    expect(client.getProfileBySlug).not.toHaveBeenCalled();
    expect(client.listProposals).not.toHaveBeenCalled();
  });

  it('shows the app logo beside the app name on the profiles screen, hidden from screen readers', () => {
    renderShell('/');
    const logo = screen.getByTestId('app-logo');
    expect(logo.tagName.toLowerCase()).toBe('svg');
    expect(logo).toHaveAttribute('aria-hidden', 'true');
    // The Lens check stroke, so a placeholder or the old briefcase would fail.
    expect(logo.querySelector('path[d="M10.2 14.3 13 17.1 18.1 11.6"]')).not.toBeNull();
    expect(screen.getByText('Job Tracker').parentElement).toContainElement(logo);
  });

  it('reports an unknown slug as missing and other lookup failures as errors', async () => {
    vi.mocked(client.getProfileBySlug).mockRejectedValue(new client.ApiError(404, 'Profile not found'));
    renderShell('/profiles/nope/jobs');
    expect(await screen.findByText('missing:-')).toBeInTheDocument();
    cleanup();
    vi.mocked(client.getProfileBySlug).mockRejectedValue(new Error('offline'));
    renderShell('/profiles/platform-roles/jobs');
    expect(await screen.findByText('error:-')).toBeInTheDocument();
  });

  it('takes a saved profile from the page at once and re-reads it when asked', async () => {
    const user = userEvent.setup();
    renderShell('/profiles/platform-roles/profile');
    expect(await screen.findByRole('link', { name: 'Back to profiles: Platform roles' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'rename' }));
    expect(screen.getByRole('link', { name: 'Back to profiles: Lead roles' })).toBeInTheDocument();
    expect(client.getProfileBySlug).toHaveBeenCalledTimes(1);
    vi.mocked(client.getProfileBySlug).mockResolvedValue({ ...TEST_PROFILE, name: 'Data roles' });
    await user.click(screen.getByRole('button', { name: 'reload' }));
    expect(await screen.findByRole('link', { name: 'Back to profiles: Data roles' })).toBeInTheDocument();
  });

  it('leaves Cmd/Ctrl+B to the browser and writes no sidebar cookie', async () => {
    renderShell();
    await screen.findByRole('link', { name: 'Review, 3 pending' });
    expect(fireEvent.keyDown(window, { key: 'b', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'b', ctrlKey: true })).toBe(true);
    expect(document.cookie).not.toContain('sidebar_state');
  });

  // jsdom does no layout; the class is the guard that wide content scrolls in its own box (SOW-0052 Decision 5).
  it('lets the main area shrink below its widest content', async () => {
    renderShell();
    await screen.findByRole('link', { name: 'Review, 3 pending' });
    expect(screen.getByRole('main')).toHaveClass('min-w-0');
  });

  it('switches to the dark theme from the sidebar menu and remembers it', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Theme: System' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toBeInTheDocument();
  });

  it('offers the version and project links from the Help & about menu, each opening in a new tab', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Help & about' }));
    const menu = await screen.findByRole('menu');
    expect(await within(menu).findByText('Version 9.9.9')).toBeInTheDocument();
    const repo = 'https://github.com/kapantzak/job-applications-tracker';
    const links = within(menu)
      .getAllByRole('menuitem')
      .map((item) => [item.textContent, item.getAttribute('href'), item.getAttribute('target'), item.getAttribute('rel')]);
    expect(links).toEqual([
      ['Documentation', `${repo}#readme`, '_blank', 'noopener noreferrer'],
      ['GitHub repository', repo, '_blank', 'noopener noreferrer'],
      ['Star on GitHub', repo, '_blank', 'noopener noreferrer'],
      ['Report an issue', `${repo}/issues/new`, '_blank', 'noopener noreferrer'],
    ]);
  });

  it('still opens the Help & about menu when the version cannot be read', async () => {
    vi.mocked(client.getHealth).mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderShell();
    // Let the failed read settle before checking that no version is shown.
    await waitFor(() => expect(client.getHealth).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Help & about' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Documentation' })).toBeInTheDocument();
    expect(within(menu).queryByText(/^Version/)).not.toBeInTheDocument();
  });
});

describe('Layout update notice', () => {
  const repo = 'https://github.com/kapantzak/job-applications-tracker';
  const newer = { current: '9.9.9', latest: '10.0.0', available: true };

  it('shows a polite banner with both versions, the update commands and the release notes', async () => {
    vi.mocked(client.getUpdate).mockResolvedValue(newer);
    renderShell('/');
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Version 10.0.0 is available (you have 9.9.9)');
    expect(banner).toHaveTextContent(
      'Update with npm i -g job-applications-tracker@latest or run npx job-applications-tracker@latest, then restart the app.',
    );
    const notes = within(banner).getByRole('link', { name: "What's new in 10.0.0" });
    expect(notes).toHaveAttribute('href', `${repo}/releases/tag/v10.0.0`);
    expect(notes).toHaveAttribute('target', '_blank');
    expect(notes).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows nothing when no newer version is known or the read fails', async () => {
    renderShell('/');
    await waitFor(() => expect(client.getUpdate).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help & about' })).toBeInTheDocument();
    cleanup();

    vi.mocked(client.getUpdate).mockRejectedValue(new Error('offline'));
    renderShell('/');
    await waitFor(() => expect(client.getUpdate).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
    expect(screen.getByText('profiles page')).toBeInTheDocument();
  });

  it('dismissal hides the banner for that version only, and the Help & about line stays', async () => {
    vi.mocked(client.getUpdate).mockResolvedValue(newer);
    const user = userEvent.setup();
    renderShell('/');
    await user.click(await screen.findByRole('button', { name: 'Dismiss update notice' }));
    expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
    expect(localStorage.getItem('update-dismissed')).toBe('10.0.0');

    await user.click(screen.getByRole('button', { name: 'Help & about, update available' }));
    const menu = await screen.findByRole('menu');
    const item = within(menu).getByRole('menuitem', { name: 'Update available: 10.0.0' });
    expect(item).toHaveAttribute('href', `${repo}/releases/tag/v10.0.0`);
    cleanup();

    // Still dismissed after a reload; a newer version brings the banner back.
    renderShell('/');
    await waitFor(() => expect(client.getUpdate).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
    cleanup();
    vi.mocked(client.getUpdate).mockResolvedValue({ ...newer, latest: '10.1.0' });
    renderShell('/');
    expect(await screen.findByRole('status')).toHaveTextContent('Version 10.1.0 is available (you have 9.9.9)');
  });

  it('reads the update status again once the first server check is due', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      renderShell('/');
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(client.getUpdate).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
      vi.mocked(client.getUpdate).mockResolvedValue(newer);
      await act(() => vi.advanceTimersByTimeAsync(15_999));
      expect(client.getUpdate).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(client.getUpdate).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('status')).toHaveTextContent('Version 10.0.0 is available');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the update status again when the window regains focus', async () => {
    renderShell('/');
    await waitFor(() => expect(client.getUpdate).toHaveBeenCalledTimes(1));
    vi.mocked(client.getUpdate).mockResolvedValue(newer);
    fireEvent.focus(window);
    expect(await screen.findByRole('status')).toHaveTextContent('Version 10.0.0 is available');
    expect(client.getUpdate).toHaveBeenCalledTimes(2);
  });

  it('re-reads the update status on navigation', async () => {
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(client.getUpdate).toHaveBeenCalledTimes(1));
    vi.mocked(client.getUpdate).mockResolvedValue(newer);
    await user.click(await screen.findByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Version 10.0.0 is available');
  });
});
