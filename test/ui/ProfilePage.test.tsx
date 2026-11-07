import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from '../../src/ui/pages/ProfilePage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile, TEST_PROFILE } from './profile-shell.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  updateProfile: vi.fn(),
}));

const profileChanged = vi.fn();

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderPage(profile = TEST_PROFILE) {
  return render(
    <InProfile profile={profile} profileChanged={profileChanged}>
      <MemoryRouter initialEntries={['/profiles/platform-roles/profile']}>
        <Routes>
          <Route path="/profiles/:profileSlug/profile" element={<ProfilePage />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </InProfile>,
  );
}

// Vitest globals are off, so Testing Library does not auto-clean.
afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ProfilePage', () => {
  it('saves the edited fields for the current profile and tells the shell', async () => {
    const user = userEvent.setup();
    vi.mocked(client.updateProfile).mockResolvedValue({ ...TEST_PROFILE, target_roles: ['Engineer', 'Lead'] });
    renderPage();
    expect(screen.getByLabelText('Name')).toHaveValue('Platform roles');
    await user.type(screen.getByLabelText('Target roles'), 'Lead,');
    await user.type(screen.getByLabelText('Locations'), 'Berlin{Enter}');
    await user.selectOptions(screen.getByLabelText('Remote'), 'hybrid');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(client.updateProfile).toHaveBeenCalledWith('pf1', {
      name: 'Platform roles',
      target_roles: ['Engineer', 'Lead'],
      locations: ['Berlin'],
      remote: 'hybrid',
      seniority: '',
      keywords: [],
      excluded_companies: [],
      notes: '',
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(profileChanged).toHaveBeenCalledWith(expect.objectContaining({ target_roles: ['Engineer', 'Lead'] }));
    expect(screen.getByTestId('where')).toHaveTextContent('/profiles/platform-roles/profile');
  });

  it('moves to the new slug after a rename', async () => {
    const user = userEvent.setup();
    const renamed = { ...TEST_PROFILE, name: 'Lead roles', slug: 'lead-roles' };
    vi.mocked(client.updateProfile).mockResolvedValue(renamed);
    renderPage();
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, '  Lead roles ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.updateProfile).toHaveBeenCalledWith('pf1', expect.objectContaining({ name: 'Lead roles' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/profiles/lead-roles/profile');
    expect(profileChanged).toHaveBeenCalledWith(renamed);
  });

  it('shows the name rule under the input, turns it into an error while invalid, and does not save', async () => {
    const user = userEvent.setup();
    renderPage();
    const name = screen.getByLabelText('Name');
    expect(name).toHaveAccessibleDescription('Letters, numbers and spaces only.');
    await user.type(name, '/Ops');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Use only letters, numbers and single spaces.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.updateProfile).not.toHaveBeenCalled();
    await user.clear(name);
    await user.type(name, 'Μηχανικός 2');
    expect(name).not.toHaveAttribute('aria-invalid');
    expect(name).toHaveAccessibleDescription('Letters, numbers and spaces only.');
  });

  it('requires a name and a target role without calling the API', async () => {
    const user = userEvent.setup();
    renderPage({ ...TEST_PROFILE, name: '', target_roles: [] });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Give the profile a name')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Data roles');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Add at least one target role')).toBeInTheDocument();
    expect(client.updateProfile).not.toHaveBeenCalled();
  });

  it('renders the server error message on ApiError and does not report a change', async () => {
    const user = userEvent.setup();
    vi.mocked(client.updateProfile).mockRejectedValue(
      new client.ApiError(409, 'A profile named "Data roles" already exists'),
    );
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A profile named "Data roles" already exists')).toBeInTheDocument();
    expect(profileChanged).not.toHaveBeenCalled();
  });
});
