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
  getProfile: vi.fn(),
  listProposals: vi.fn(),
}));

// App keeps a once-per-load flag at module level; a fresh module per test is a fresh page load.
async function renderApp(path: string) {
  vi.resetModules();
  const client = await import('../../src/ui/api/client.js');
  vi.mocked(client.getSettings).mockResolvedValue({ adapter_id: 'claude' } as never);
  vi.mocked(client.getAdapters).mockResolvedValue([{ id: 'claude', installed, gmail_guide: false }]);
  vi.mocked(client.listProfiles).mockResolvedValue([]);
  vi.mocked(client.getProfile).mockResolvedValue({
    id: 'pf1',
    name: 'Platform roles',
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

  it('shows the profile sidebar inside a profile', async () => {
    await renderApp('/profiles/pf1/profile');
    expect(await screen.findByRole('navigation', { name: 'Profile' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Name')).toHaveValue('Platform roles');
    expect(screen.getAllByText('Platform roles').length).toBeGreaterThan(0);
  });
});
