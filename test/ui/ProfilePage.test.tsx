import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../../src/server/domain/types.js';
import { ProfilePage } from '../../src/ui/pages/ProfilePage.js';
import { ProfileShellContext } from '../../src/ui/profile-route.js';
import * as client from '../../src/ui/api/client.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

const PROFILE: Profile = {
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
};

const profileChanged = vi.fn();

function renderPage() {
  return render(
    <ProfileShellContext.Provider value={{ profileChanged }}>
      <MemoryRouter initialEntries={['/profiles/pf1/profile']}>
        <Routes>
          <Route path="/profiles/:profileId/profile" element={<ProfilePage />} />
        </Routes>
      </MemoryRouter>
    </ProfileShellContext.Provider>,
  );
}

// Vitest globals are off, so Testing Library does not auto-clean.
afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.getProfile).mockResolvedValue(PROFILE);
});

describe('ProfilePage', () => {
  it('loads the profile from the URL and saves the edited fields, then tells the shell', async () => {
    const user = userEvent.setup();
    vi.mocked(client.updateProfile).mockResolvedValue(PROFILE);
    renderPage();
    const name = await screen.findByLabelText('Name');
    expect(client.getProfile).toHaveBeenCalledWith('pf1');
    expect(name).toHaveValue('Platform roles');
    await user.clear(name);
    await user.type(name, '  Lead roles ');
    await user.type(screen.getByLabelText('Target roles'), 'Lead,');
    await user.type(screen.getByLabelText('Locations'), 'Berlin{Enter}');
    await user.selectOptions(screen.getByLabelText('Remote'), 'hybrid');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(client.updateProfile).toHaveBeenCalledWith('pf1', {
      name: 'Lead roles',
      target_roles: ['Engineer', 'Lead'],
      locations: ['Berlin'],
      remote: 'hybrid',
      seniority: '',
      keywords: [],
      excluded_companies: [],
      notes: '',
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(profileChanged).toHaveBeenCalledTimes(1);
  });

  it('renders the server error message on ApiError and does not report a change', async () => {
    const user = userEvent.setup();
    vi.mocked(client.updateProfile).mockRejectedValue(
      new client.ApiError(409, 'A profile named "Data roles" already exists'),
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A profile named "Data roles" already exists')).toBeInTheDocument();
    expect(profileChanged).not.toHaveBeenCalled();
  });

  it('requires a name and a target role without calling the API', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getProfile).mockResolvedValue({ ...PROFILE, name: '', target_roles: [] });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(screen.getByText('Give the profile a name')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Data roles');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Add at least one target role')).toBeInTheDocument();
    expect(client.updateProfile).not.toHaveBeenCalled();
  });

  it('shows the error when the profile cannot be loaded', async () => {
    vi.mocked(client.getProfile).mockRejectedValue(new client.ApiError(404, 'Profile not found'));
    renderPage();
    expect(await screen.findByText('Profile not found')).toBeInTheDocument();
  });
});
