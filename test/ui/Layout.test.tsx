import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  getProfileBySlug: vi.fn(),
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
  vi.mocked(client.getProfileBySlug).mockResolvedValue(TEST_PROFILE);
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
    const review = await screen.findByRole('link', { name: 'Review, 2 pending' });
    expect(client.listProposals).toHaveBeenCalledWith('pf1');
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
    await screen.findByRole('link', { name: 'Review, 2 pending' });
    expect(fireEvent.keyDown(window, { key: 'b', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'b', ctrlKey: true })).toBe(true);
    expect(document.cookie).not.toContain('sidebar_state');
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
});
