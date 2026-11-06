import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from '../../src/ui/components/Layout.js';
import * as client from '../../src/ui/api/client.js';
import { useProfileShell } from '../../src/ui/profile-route.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listProposals: vi.fn(),
  getProfile: vi.fn(),
}));

function RenamePage() {
  const { profileChanged } = useProfileShell();
  return (
    <button type="button" onClick={profileChanged}>
      rename
    </button>
  );
}

function renderShell(path = '/profiles/pf1/review') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>profiles page</p>} />
          <Route path="profiles/new" element={<p>new profile page</p>} />
          <Route path="profiles/:profileId/review" element={<p>review page</p>} />
          <Route path="profiles/:profileId/profile" element={<RenamePage />} />
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
  vi.mocked(client.getProfile).mockResolvedValue({ id: 'pf1', name: 'Platform roles' } as never);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.cookie = 'sidebar_state=; max-age=0; path=/';
});

describe('Layout', () => {
  it("inside a profile, shows its name, its pages and that profile's pending count in the Review link", async () => {
    renderShell();
    expect(screen.getByText('review page')).toBeInTheDocument();
    const review = await screen.findByRole('link', { name: 'Review, 2 pending' });
    expect(client.listProposals).toHaveBeenCalledWith('pf1');
    expect(review).toHaveAttribute('href', '/profiles/pf1/review');
    expect(review).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('Platform roles')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Profile' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/profiles/pf1');
    expect(within(nav).getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/profiles/pf1/jobs');
    expect(screen.getByRole('link', { name: 'Switch profile' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it.each(['/', '/profiles/new'])('at %s, shows only Profiles and Settings and fetches nothing', async (path) => {
    renderShell(path);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Profiles', 'Settings']);
    expect(screen.queryByRole('navigation', { name: 'Profile' })).not.toBeInTheDocument();
    expect(client.getProfile).not.toHaveBeenCalled();
    expect(client.listProposals).not.toHaveBeenCalled();
  });

  it('re-reads the profile name when a page reports a change', async () => {
    const user = userEvent.setup();
    renderShell('/profiles/pf1/profile');
    expect(await screen.findByText('Platform roles')).toBeInTheDocument();
    vi.mocked(client.getProfile).mockResolvedValue({ id: 'pf1', name: 'Lead roles' } as never);
    await user.click(screen.getByRole('button', { name: 'rename' }));
    expect(await screen.findByText('Lead roles')).toBeInTheDocument();
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
