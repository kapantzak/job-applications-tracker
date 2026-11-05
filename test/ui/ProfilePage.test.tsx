import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from '../../src/ui/pages/ProfilePage.js';
import * as client from '../../src/ui/api/client.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  getProfile: vi.fn(),
  putProfile: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );
}

// Vitest globals are off, so Testing Library does not auto-clean.
afterEach(cleanup);

beforeEach(() => {
  vi.mocked(client.getProfile).mockResolvedValue(null);
  vi.mocked(client.putProfile).mockReset();
});

describe('ProfilePage', () => {
  it('submits arrays built from tag entries', async () => {
    const user = userEvent.setup();
    vi.mocked(client.putProfile).mockResolvedValue({} as never);
    renderPage();
    await user.type(await screen.findByLabelText('Target roles'), 'Engineer{Enter}Lead,');
    await user.type(screen.getByLabelText('Locations'), 'Berlin{Enter}');
    await user.selectOptions(screen.getByLabelText('Remote'), 'hybrid');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(client.putProfile).toHaveBeenCalledWith({
      target_roles: ['Engineer', 'Lead'],
      locations: ['Berlin'],
      remote: 'hybrid',
      seniority: '',
      keywords: [],
      excluded_companies: [],
      notes: '',
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('renders the server error message on ApiError', async () => {
    const user = userEvent.setup();
    vi.mocked(client.putProfile).mockRejectedValue(new client.ApiError(400, 'target_roles invalid'));
    renderPage();
    await user.type(await screen.findByLabelText('Target roles'), 'Engineer{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('target_roles invalid')).toBeInTheDocument();
  });

  it('requires a target role without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Target roles');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Add at least one target role')).toBeInTheDocument();
    expect(client.putProfile).not.toHaveBeenCalled();
  });
});
