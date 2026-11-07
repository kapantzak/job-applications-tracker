import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationsPage } from '../../src/ui/pages/ApplicationsPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listApplications: vi.fn(),
  createApplication: vi.fn(),
  setApplicationStatus: vi.fn(),
  startSync: vi.fn(),
}));

const app = {
  id: 'a1',
  company: 'Acme',
  role: 'Dev',
  url: 'javascript:alert(1)',
  status: 'applied',
  applied_at: null,
};

function renderPage() {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={['/profiles/platform-roles/applications']}>
        <Routes>
          <Route path="/profiles/:profileSlug/applications" element={<ApplicationsPage />} />
          <Route path="/profiles/:profileSlug/runs/:id" element={<p>run page</p>} />
        </Routes>
      </MemoryRouter>
    </InProfile>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.listApplications).mockResolvedValue([app] as never);
});

describe('ApplicationsPage', () => {
  it('posts the new status and updates the row', async () => {
    const user = userEvent.setup();
    vi.mocked(client.setApplicationStatus).mockResolvedValue({
      ...app,
      status: 'interview',
    } as never);
    renderPage();
    const select = await screen.findByLabelText('Status', {
      selector: 'td select',
    });
    await user.selectOptions(select, 'interview');
    expect(client.setApplicationStatus).toHaveBeenCalledWith('pf1', 'a1', 'interview');
    expect(await screen.findByDisplayValue('interview')).toBeInTheDocument();
  });

  it('does not render a link for non-http urls', async () => {
    renderPage();
    await screen.findByText('Acme');
    expect(screen.queryByRole('link', { name: 'Open posting' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/profiles/platform-roles/applications/a1');
  });

  it('creates an application with an ISO applied date', async () => {
    const user = userEvent.setup();
    vi.mocked(client.createApplication).mockResolvedValue({
      ...app,
      id: 'a2',
      company: 'Beta',
    } as never);
    renderPage();
    await screen.findByText('Acme');
    await user.click(screen.getByRole('button', { name: 'Add application' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add application' });
    await user.type(within(sheet).getByLabelText('Company'), 'Beta');
    await user.type(within(sheet).getByLabelText('Role'), 'Lead');
    await user.type(within(sheet).getByLabelText('Applied date'), '2026-03-04');
    await user.click(within(sheet).getByRole('button', { name: 'Add' }));
    expect(client.createApplication).toHaveBeenCalledWith(
      'pf1',
      expect.objectContaining({
        company: 'Beta',
        role: 'Lead',
        status: 'applied',
        applied_at: '2026-03-04T00:00:00.000Z',
      }),
    );
    expect(await screen.findByText('Beta')).toBeInTheDocument();
    // A successful add closes the sheet.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('omits applied_at when no date is given so the server default applies', async () => {
    const user = userEvent.setup();
    vi.mocked(client.createApplication).mockResolvedValue({ ...app, id: 'a3', company: 'Gamma' } as never);
    renderPage();
    await screen.findByText('Acme');
    await user.click(screen.getByRole('button', { name: 'Add application' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add application' });
    await user.type(within(sheet).getByLabelText('Company'), 'Gamma');
    await user.type(within(sheet).getByLabelText('Role'), 'Dev');
    await user.click(within(sheet).getByRole('button', { name: 'Add' }));
    const payload = vi.mocked(client.createApplication).mock.calls[0]![1];
    expect(payload).toMatchObject({ company: 'Gamma', role: 'Dev', status: 'applied' });
    expect(payload).not.toHaveProperty('applied_at');
    expect(await screen.findByText('Gamma')).toBeInTheDocument();
  });

  it('starts a sync and navigates to the run', async () => {
    const user = userEvent.setup();
    vi.mocked(client.startSync).mockResolvedValue({ id: 'r9' } as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Sync from Gmail' }));
    expect(await screen.findByText('run page')).toBeInTheDocument();
  });
});
