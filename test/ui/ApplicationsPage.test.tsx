import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationsPage } from '../../src/ui/pages/ApplicationsPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';
import { useListReturnHref } from '../../src/ui/hooks/use-table-view.js';

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

// Stands in for the detail page's back link.
function BackLinkProbe() {
  return <p data-testid="back">{useListReturnHref('/profiles/platform-roles/applications')}</p>;
}

function renderPage(search = '') {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={[`/profiles/platform-roles/applications${search}`]}>
        <Routes>
          <Route path="/profiles/:profileSlug/applications" element={<ApplicationsPage />} />
          <Route path="/profiles/:profileSlug/applications/:id" element={<BackLinkProbe />} />
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
  it('says what Sync from Gmail searches', async () => {
    renderPage();
    expect(await screen.findByText(/Sync searches by company and job-board senders\./)).toBeInTheDocument();
  });

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
        // Local midnight of the typed day, whatever zone the suite runs in (SOW-0030).
        applied_at: new Date(2026, 2, 4).toISOString(),
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

describe('ApplicationsPage sorting and filters', () => {
  const apps = [
    { ...app, id: 'a3', company: 'Initech', role: 'SRE', status: 'saved', applied_at: null, url: null },
    { ...app, id: 'a2', company: 'Globex', role: 'Data Engineer', status: 'interview', applied_at: '2026-11-04T09:00:00' },
    { ...app, id: 'a1', company: 'Acme', role: 'Platform Engineer', status: 'applied', applied_at: '2026-11-01T09:00:00' },
  ];
  const companies = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);

  beforeEach(() => {
    vi.mocked(client.listApplications).mockResolvedValue(apps as never);
  });

  it('sorts statuses in lifecycle order and dates with empty ones last', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');
    await user.click(within(screen.getByRole('columnheader', { name: /^Status/ })).getByRole('button'));
    expect(companies()).toEqual(['Initech', 'Acme', 'Globex']);
    await user.click(within(screen.getByRole('columnheader', { name: /^Applied/ })).getByRole('button'));
    expect(companies()).toEqual(['Acme', 'Globex', 'Initech']);
    await user.click(within(screen.getByRole('columnheader', { name: /^Applied/ })).getByRole('button'));
    expect(companies()).toEqual(['Globex', 'Acme', 'Initech']);
  });

  it('drops a row from a status filter as soon as its status changes', async () => {
    const user = userEvent.setup();
    vi.mocked(client.setApplicationStatus).mockResolvedValue({ ...apps[2], status: 'screening' } as never);
    renderPage('?status=applied&status=interview');
    await screen.findByText('Acme');
    expect(companies()).toEqual(['Globex', 'Acme']);
    const row = screen.getByText('Acme').closest('tr')!;
    await user.selectOptions(within(row).getByLabelText('Status'), 'screening');
    await vi.waitFor(() => expect(companies()).toEqual(['Globex']));
  });

  it('filters the Applied date, leaving out applications without one', async () => {
    renderPage('?applied=2026-10-01..');
    await screen.findByText('Acme');
    expect(companies()).toEqual(['Globex', 'Acme']);
    expect(within(screen.getByRole('group', { name: 'Filter applications' })).getByRole('button', { name: /^Filter by applied/ })).toHaveTextContent(/^Applied.*From /);
  });

  it('adds a start day to an "until" range instead of clearing it', async () => {
    const user = userEvent.setup();
    renderPage('?applied=..2026-11-05');
    await screen.findByText('Acme');
    expect(companies()).toEqual(['Globex', 'Acme']);
    await user.click(within(screen.getByRole('group', { name: 'Filter applications' })).getByRole('button', { name: /^Filter by applied/ }));
    const popover = await screen.findByRole('dialog', { name: 'Filter by applied' });
    await user.click(within(popover).getByRole('button', { name: /November 3rd, 2026/ }));
    expect(companies()).toEqual(['Globex']);
  });

  it('filters by role text and by company', async () => {
    const user = userEvent.setup();
    renderPage('?role=engineer');
    await screen.findByText('Acme');
    expect(companies()).toEqual(['Globex', 'Acme']);
    await user.click(within(screen.getByRole('group', { name: 'Filter applications' })).getByRole('button', { name: /^Filter by company/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Filter by company' })).getByRole('checkbox', { name: 'Acme' }));
    expect(companies()).toEqual(['Acme']);
  });

  it('returns from Details to the same filtered view', async () => {
    const user = userEvent.setup();
    renderPage('?q=engineer&sort=company');
    await screen.findByText('Acme');
    await user.click(within(screen.getByText('Acme').closest('tr')!).getByRole('link', { name: 'Details' }));
    expect(await screen.findByTestId('back')).toHaveTextContent('/profiles/platform-roles/applications?q=engineer&sort=company');
  });

  it('returns to the plain list when Details was opened without a view', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Acme');
    await user.click(within(screen.getByText('Acme').closest('tr')!).getByRole('link', { name: 'Details' }));
    expect(await screen.findByTestId('back')).toHaveTextContent(/^\/profiles\/platform-roles\/applications$/);
  });
});
