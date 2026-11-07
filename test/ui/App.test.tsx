import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ClientModule from '../../src/ui/api/client.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ClientModule>()),
  getSettings: vi.fn(),
  getAdapters: vi.fn(),
  listProfiles: vi.fn(),
  getProfileBySlug: vi.fn(),
  listProposals: vi.fn(),
  listJobs: vi.fn(),
  updateProfile: vi.fn(),
}));

// App keeps a once-per-load flag at module level; a fresh module per test is a fresh page load.
async function renderApp(path: string, configure?: (client: typeof ClientModule) => void) {
  vi.resetModules();
  const client = await import('../../src/ui/api/client.js');
  vi.mocked(client.getSettings).mockResolvedValue({ adapter_id: 'claude' } as never);
  vi.mocked(client.getAdapters).mockResolvedValue([{ id: 'claude', installed, gmail_guide: false }]);
  vi.mocked(client.listProfiles).mockResolvedValue([]);
  vi.mocked(client.getProfileBySlug).mockResolvedValue({
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
    created_at: '2026-11-01T00:00:00.000Z',
  });
  vi.mocked(client.listProposals).mockResolvedValue([]);
  configure?.(client);
  const { App } = await import('../../src/ui/App.js');
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return client;
}

let installed: boolean;

afterEach(cleanup);

beforeEach(() => {
  installed = true;
});

describe('App routing', () => {
  it('opens on the profiles screen, which asks for a first profile when there is none', async () => {
    await renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Create your first profile' })).toBeInTheDocument();
  });

  it('sends a missing agent to Setup once, then lets the Profiles link reach the profiles screen', async () => {
    const user = userEvent.setup();
    installed = false;
    const client = await renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Setup' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Profiles' }));
    expect(await screen.findByRole('heading', { name: 'Create your first profile' })).toBeInTheDocument();
    expect(client.getSettings).toHaveBeenCalled();
  });

  it('redirects old single-profile paths to the profiles screen', async () => {
    await renderApp('/jobs');
    expect(await screen.findByRole('heading', { name: 'Create your first profile' })).toBeInTheDocument();
  });

  it('opens a profile page by slug with the profile header', async () => {
    const client = await renderApp('/profiles/platform-roles/profile');
    expect(await screen.findByLabelText('Name')).toHaveValue('Platform roles');
    expect(client.getProfileBySlug).toHaveBeenCalledWith('platform-roles');
    expect(screen.getByRole('link', { name: 'Back to profiles: Platform roles' })).toHaveAttribute('href', '/');
  });

  it('shows Profile not found with a way back for an unknown slug', async () => {
    const user = userEvent.setup();
    await renderApp('/profiles/old-name/jobs', (client) => {
      vi.mocked(client.getProfileBySlug).mockRejectedValue(new client.ApiError(404, 'Profile not found'));
    });
    expect(await screen.findByText('Profile not found')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Back to profiles' }));
    expect(await screen.findByRole('heading', { name: 'Create your first profile' })).toBeInTheDocument();
  });

  it('resolves a non-Latin slug from a percent-encoded URL and links to it encoded', async () => {
    const slug = 'μηχανικος';
    const client = await renderApp(`/profiles/${encodeURIComponent(slug)}/jobs`, (c) => {
      vi.mocked(c.getProfileBySlug).mockResolvedValue({
        id: 'pg',
        name: 'Μηχανικός',
        slug,
        target_roles: ['Engineer'],
        locations: [],
        remote: 'any',
        seniority: '',
        keywords: [],
        excluded_companies: [],
        notes: '',
        created_at: '2026-11-01T00:00:00.000Z',
      });
      vi.mocked(c.listJobs).mockResolvedValue([]);
    });
    expect(await screen.findByRole('link', { name: 'Back to profiles: Μηχανικός' })).toBeInTheDocument();
    expect(client.getProfileBySlug).toHaveBeenCalledWith(slug);
    expect(client.listJobs).toHaveBeenCalledWith('pg', expect.anything());
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', `/profiles/${encodeURIComponent(slug)}/jobs`);
  });

  it('renames a profile in place: new URL, no remount, Saved stays and no second lookup', async () => {
    const user = userEvent.setup();
    const client = await renderApp('/profiles/platform-roles/profile', (c) => {
      vi.mocked(c.updateProfile).mockImplementation(async (id, input) => ({
        ...input,
        id,
        slug: 'lead-roles',
        created_at: '2026-11-01T00:00:00.000Z',
      }));
    });
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Lead roles');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    // "Saved" is an urgent update; the new profile commits in a transition, which can land a render later.
    expect(await screen.findByRole('link', { name: 'Back to profiles: Lead roles' })).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBe(name);
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/profiles/lead-roles/jobs');
    expect(vi.mocked(client.getProfileBySlug).mock.calls).toEqual([['platform-roles']]);
  });
});
