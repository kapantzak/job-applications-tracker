import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

function SearchProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderPage(search = '') {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={[`/profiles/platform-roles/applications${search}`]}>
        <SearchProbe />
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
  it('explains each field of a new application and lists readable statuses', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Acme');
    await user.click(screen.getByRole('button', { name: 'Add application' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add application' });
    for (const topic of ['Company', 'Role', 'URL', 'Status', 'Applied date', 'Notes']) {
      expect(within(sheet).getByRole('button', { name: `About ${topic}` })).toBeInTheDocument();
    }
    expect(within(within(sheet).getByLabelText('Status')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Saved',
      'Applied',
      'Screening',
      'Interview',
      'Offer',
      'Rejected',
      'Withdrawn',
      'No response',
    ]);
  });

  it('says what Sync from Gmail searches', async () => {
    renderPage();
    expect(await screen.findByText(/Sync searches by company and job-board senders\./)).toBeInTheDocument();
  });

  it('explains Sync from Gmail next to its button', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'About Sync from Gmail' }));
    expect(await screen.findByRole('dialog', { name: 'About Sync from Gmail' })).toHaveTextContent(
      /nothing changes until you accept/,
    );
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
    expect(await screen.findByDisplayValue('Interview')).toBeInTheDocument();
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
  const dateButton = (bound: 'from' | 'to') =>
    within(screen.getByRole('group', { name: 'Filter applications' })).getByRole('button', { name: new RegExp(`^Filter by applied ${bound}($|:)`) });
  const dayText = (y: number, m: number, d: number) => new Date(y, m, d).toLocaleDateString(undefined, { dateStyle: 'medium' });

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

  it('filters the Applied date from a day on, leaving out applications without one', async () => {
    renderPage('?applied=2026-10-01..');
    await screen.findByText('Acme');
    expect(companies()).toEqual(['Globex', 'Acme']);
    expect(dateButton('from')).toHaveTextContent(new RegExp(`^Applied from.*${dayText(2026, 9, 1)}`));
    expect(dateButton('to')).toHaveAccessibleName('Filter by applied to');
  });

  it('keeps every application on or after a picked "Applied from" day, with no end', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 9, 12));
    try {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Acme');
      await user.click(dateButton('from'));
      const popover = await screen.findByRole('dialog', { name: 'Filter by applied from' });
      await user.click(within(popover).getByRole('button', { name: /November 3rd, 2026/ }));
      expect(companies()).toEqual(['Globex']);
      expect(screen.getByTestId('search')).toHaveTextContent(/^\?applied=2026-11-03\.\.$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps every application up to a picked "Applied to" day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 9, 12));
    try {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Acme');
      await user.click(dateButton('to'));
      const popover = await screen.findByRole('dialog', { name: 'Filter by applied to' });
      await user.click(within(popover).getByRole('button', { name: /November 3rd, 2026/ }));
      expect(companies()).toEqual(['Acme']);
      expect(screen.getByTestId('search')).toHaveTextContent(/^\?applied=\.\.2026-11-03$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables days on the wrong side of the other end', async () => {
    const user = userEvent.setup();
    renderPage('?applied=2026-11-02..2026-11-05');
    await screen.findByText('Globex');
    await user.click(dateButton('from'));
    const from = await screen.findByRole('dialog', { name: 'Filter by applied from' });
    expect(within(from).getByRole('button', { name: /November 5th, 2026/ })).toBeEnabled();
    expect(within(from).getByRole('button', { name: /November 6th, 2026/ })).toBeDisabled();
    await user.keyboard('{Escape}');
    await user.click(dateButton('to'));
    const to = await screen.findByRole('dialog', { name: 'Filter by applied to' });
    expect(within(to).getByRole('button', { name: /November 2nd, 2026/ })).toBeEnabled();
    expect(within(to).getByRole('button', { name: /November 1st, 2026/ })).toBeDisabled();
  });

  it('clears one end and keeps the other', async () => {
    const user = userEvent.setup();
    renderPage('?applied=2026-10-01..2026-11-02');
    await screen.findByText('Acme');
    expect(companies()).toEqual(['Acme']);
    await user.click(dateButton('to'));
    await user.click(within(await screen.findByRole('dialog', { name: 'Filter by applied to' })).getByRole('button', { name: 'Clear' }));
    expect(companies()).toEqual(['Globex', 'Acme']);
    expect(screen.getByTestId('search')).toHaveTextContent(/^\?applied=2026-10-01\.\.$/);
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
