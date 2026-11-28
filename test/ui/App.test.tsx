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
  getHealth: vi.fn(),
  getUpdate: vi.fn(),
  listProposals: vi.fn(),
  listApplicationProposals: vi.fn(),
  listJobs: vi.fn(),
  updateProfile: vi.fn(),
  getCvAnalysis: vi.fn(),
  getDashboard: vi.fn(),
  listApplications: vi.fn(),
  listApplicationHistory: vi.fn(),
  listRuns: vi.fn(),
}));

// App keeps a once-per-load flag at module level; a fresh module per test is a fresh page load.
async function renderApp(path: string, configure?: (client: typeof ClientModule) => void) {
  vi.resetModules();
  const client = await import('../../src/ui/api/client.js');
  vi.mocked(client.getSettings).mockResolvedValue({ adapter_id: 'claude' } as never);
  vi.mocked(client.getHealth).mockResolvedValue({ ok: true, version: '9.9.9', dataDir: '/data' });
  vi.mocked(client.getUpdate).mockResolvedValue({ current: '9.9.9', latest: null, available: false });
  vi.mocked(client.getAdapters).mockResolvedValue([{ id: 'claude', installed, gmail_guide: false }]);
  vi.mocked(client.listProfiles).mockResolvedValue([]);
  vi.mocked(client.getCvAnalysis).mockResolvedValue(null);
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
    mail_filter_kind: 'label',
    mail_filter: '',
    cv: null,
    created_at: '2026-11-01T00:00:00.000Z',
  });
  vi.mocked(client.listProposals).mockResolvedValue([]);
  vi.mocked(client.listApplicationProposals).mockResolvedValue([]);
  // The Dashboard tolerates failed loads; resolving them keeps the default-profile tests quiet.
  vi.mocked(client.getDashboard).mockRejectedValue(new Error('not loaded in this test'));
  vi.mocked(client.listApplications).mockResolvedValue([]);
  vi.mocked(client.listApplicationHistory).mockResolvedValue([]);
  vi.mocked(client.listJobs).mockResolvedValue([]);
  vi.mocked(client.listRuns).mockResolvedValue([]);
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
        mail_filter_kind: 'label',
        mail_filter: '',
        cv: null,
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
        cv: null,
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

const listItem = (id: string, name: string, slug: string) =>
  ({ id, name, slug, target_roles: [], counts: { jobs: 0, applications: 0, runs: 0 }, cv_analysis_status: null }) as never;

describe('default profile on launch (SOW-0059)', () => {
  it('opens the stored default profile on the first load of /, and the Profiles link then shows the list', async () => {
    const user = userEvent.setup();
    const client = await renderApp('/', (c) => {
      vi.mocked(c.getSettings).mockResolvedValue({ adapter_id: 'claude', default_profile_id: 'pf1' } as never);
      vi.mocked(c.listProfiles).mockResolvedValue([
        listItem('pf0', 'Data roles', 'data-roles'),
        listItem('pf1', 'Platform roles', 'platform-roles'),
      ]);
    });
    expect(await screen.findByRole('link', { name: 'Back to profiles: Platform roles' })).toBeInTheDocument();
    expect(client.getProfileBySlug).toHaveBeenCalledWith('platform-roles');
    await user.click(screen.getByRole('link', { name: 'Back to profiles: Platform roles' }));
    expect(await screen.findByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Profiles' }));
    expect(await screen.findByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    expect(client.getProfileBySlug).toHaveBeenCalledTimes(1);
  });

  it('opens the only profile when no default is stored', async () => {
    const client = await renderApp('/', (c) => {
      vi.mocked(c.getSettings).mockResolvedValue({ adapter_id: 'claude', default_profile_id: '' } as never);
      vi.mocked(c.listProfiles).mockResolvedValue([listItem('pf1', 'Platform roles', 'platform-roles')]);
    });
    expect(await screen.findByRole('link', { name: 'Back to profiles: Platform roles' })).toBeInTheDocument();
    expect(client.getProfileBySlug).toHaveBeenCalledWith('platform-roles');
  });

  it('shows the profiles screen for several profiles without a valid default', async () => {
    const client = await renderApp('/', (c) => {
      vi.mocked(c.getSettings).mockResolvedValue({ adapter_id: 'claude', default_profile_id: 'deleted' } as never);
      vi.mocked(c.listProfiles).mockResolvedValue([
        listItem('pf0', 'Data roles', 'data-roles'),
        listItem('pf1', 'Platform roles', 'platform-roles'),
      ]);
    });
    expect(await screen.findByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    expect(client.getProfileBySlug).not.toHaveBeenCalled();
  });

  it('sends a missing agent to Setup instead, and does not jump later in the same load', async () => {
    const user = userEvent.setup();
    installed = false;
    const client = await renderApp('/', (c) => {
      vi.mocked(c.getSettings).mockResolvedValue({ adapter_id: 'claude', default_profile_id: 'pf1' } as never);
      vi.mocked(c.listProfiles).mockResolvedValue([listItem('pf1', 'Platform roles', 'platform-roles')]);
    });
    expect(await screen.findByRole('heading', { name: 'Setup' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Profiles' }));
    expect(await screen.findByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    expect(client.getProfileBySlug).not.toHaveBeenCalled();
  });

  it('shows the profiles screen when the profile list cannot be loaded at startup', async () => {
    const client = await renderApp('/', (c) => {
      vi.mocked(c.listProfiles).mockRejectedValueOnce(new Error('offline'));
      vi.mocked(c.listProfiles).mockResolvedValue([listItem('pf1', 'Platform roles', 'platform-roles')]);
    });
    expect(await screen.findByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    expect(client.getProfileBySlug).not.toHaveBeenCalled();
  });

  it.each([
    ['/settings', 'Settings'],
    ['/profiles/platform-roles/jobs', 'Back to profiles: Platform roles'],
  ])('does not jump when the page load started on %s and the user goes to the profiles screen', async (start, link) => {
    const user = userEvent.setup();
    const client = await renderApp(start, (c) => {
      vi.mocked(c.getSettings).mockResolvedValue({ adapter_id: 'claude', default_profile_id: 'pf1' } as never);
      vi.mocked(c.listProfiles).mockResolvedValue([
        listItem('pf0', 'Data roles', 'data-roles'),
        listItem('pf1', 'Platform roles', 'platform-roles'),
      ]);
    });
    if (link === 'Settings') expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    const back = link === 'Settings' ? 'Profiles' : link;
    await user.click(await screen.findByRole('link', { name: back }));
    expect(await screen.findByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    // Give a wrongly started jump time to happen before checking that none did.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to profiles: Platform roles' })).not.toBeInTheDocument();
  });
});
