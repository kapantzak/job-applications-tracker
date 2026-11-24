import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationsPage } from '../../src/ui/pages/ApplicationsPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';
import { useListReturnHref, useListReturnState } from '../../src/ui/hooks/use-table-view.js';
import { ONE_TIME_VIEW } from '../../src/ui/view-storage.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listApplications: vi.fn(),
  createApplication: vi.fn(),
  setApplicationStatus: vi.fn(),
  mergeApplications: vi.fn(),
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
  const href = useListReturnHref('/profiles/platform-roles/applications');
  const state = useListReturnState();
  return (
    <>
      <p data-testid="back">{href}</p>
      <p data-testid="back-state">{JSON.stringify(state ?? null)}</p>
    </>
  );
}

function SearchProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderPage(search = '', state?: unknown) {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={[{ pathname: '/profiles/platform-roles/applications', search, state }]}>
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
  const companies = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1]!.textContent);
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

// One filter set per profile, shared with the Dashboard (SOW-0054, decisions 7A, 8B, 9A).
describe('ApplicationsPage shared view', () => {
  const STORAGE_KEY = 'application-filters:pf1';
  const apps = [
    { ...app, id: 'a2', company: 'Globex', role: 'Data Engineer', status: 'interview', url: null },
    { ...app, id: 'a1', company: 'Acme', role: 'Platform Engineer', status: 'applied', url: null },
  ];
  const companies = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1]!.textContent);
  const bar = () => within(screen.getByRole('group', { name: 'Filter applications' }));
  const search = () => screen.getByTestId('search');

  beforeEach(() => {
    vi.mocked(client.listApplications).mockResolvedValue(apps as never);
  });

  it('opens without a view on the saved one, sort included', async () => {
    localStorage.setItem(STORAGE_KEY, 'sort=-company&status=applied&status=interview&company=Acme');
    renderPage();
    await waitFor(() => expect(search()).toHaveTextContent('?sort=-company&company=Acme&status=applied&status=interview'));
    expect(companies()).toEqual(['Acme']);
  });

  it('saves a view that arrives in the URL', async () => {
    localStorage.setItem(STORAGE_KEY, 'company=Acme');
    renderPage('?status=interview');
    await screen.findByText('Globex');
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('status=interview'));
    expect(companies()).toEqual(['Globex']);
  });

  it('saves every change, sort included', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Acme');
    await user.click(within(screen.getByRole('columnheader', { name: /^Company/ })).getByRole('button'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('sort=company');
    await user.click(bar().getByRole('button', { name: 'Filter by company' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Filter by company' })).getByRole('checkbox', { name: /^Globex/ }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('sort=company&company=Globex');
  });

  it('Reset clears the saved filters and does not load them back', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, 'company=Acme');
    renderPage();
    await waitFor(() => expect(search()).toHaveTextContent('?company=Acme'));
    await user.click(bar().getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(search()).toHaveTextContent(/^$/));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(companies()).toEqual(['Globex', 'Acme']);
  });

  it('shows a one-time view from a Dashboard tile without saving it', async () => {
    localStorage.setItem(STORAGE_KEY, 'company=Acme');
    renderPage('?company=Acme&status=interview', ONE_TIME_VIEW);
    expect(await screen.findByText('No rows match your filters')).toBeInTheDocument();
    expect(search()).toHaveTextContent('?company=Acme&status=interview');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('company=Acme');
  });

  it('saves a one-time view once the user changes it', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, 'company=Acme');
    renderPage('?status=interview', ONE_TIME_VIEW);
    await screen.findByText('Globex');
    await user.click(within(screen.getByRole('columnheader', { name: /^Company/ })).getByRole('button'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('sort=company&status=interview');
  });

  it('Reset in a one-time view clears the saved filters too', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, 'company=Acme');
    renderPage('?status=interview', ONE_TIME_VIEW);
    await screen.findByText('Globex');
    await user.click(bar().getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(search()).toHaveTextContent(/^$/));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(companies()).toEqual(['Globex', 'Acme']);
  });

  it('keeps a one-time view one-time on the way back from Details', async () => {
    const user = userEvent.setup();
    renderPage('?status=interview', ONE_TIME_VIEW);
    await screen.findByText('Globex');
    await user.click(within(screen.getByText('Globex').closest('tr')!).getByRole('link', { name: 'Details' }));
    expect(await screen.findByTestId('back')).toHaveTextContent('/profiles/platform-roles/applications?status=interview');
    expect(screen.getByTestId('back-state')).toHaveTextContent('{"oneTimeView":true}');
  });

  it('a back link from a saved view carries no one-time marker', async () => {
    const user = userEvent.setup();
    renderPage('?status=interview');
    await screen.findByText('Globex');
    await user.click(within(screen.getByText('Globex').closest('tr')!).getByRole('link', { name: 'Details' }));
    expect(await screen.findByTestId('back-state')).toHaveTextContent('null');
  });
});

describe('ApplicationsPage merging (SOW-0055)', () => {
  const base = { ...app, url: null, job_id: null, notes: null, sender_domains: [], profile_id: 'pf1', status_changed_at: '2026-11-01T09:00:00' };
  const apps = [
    { ...base, id: 'a3', company: 'Initech', role: 'SRE', status: 'applied', applied_at: '2026-11-03T09:00:00', created_at: '2026-11-03T09:00:00' },
    { ...base, id: 'a2', company: 'acme ', role: 'Engineer (React)', status: 'screening', applied_at: '2026-11-02T09:00:00', created_at: '2026-11-02T09:00:00' },
    { ...base, id: 'a1', company: 'Acme', role: 'Senior Engineer', status: 'interview', applied_at: '2026-11-01T09:00:00', created_at: '2026-11-01T09:00:00' },
  ];
  const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2]!.textContent);
  const select = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole('checkbox', { name: `Select ${name}` }));

  beforeEach(() => {
    vi.mocked(client.listApplications).mockResolvedValue(apps as never);
  });

  it('offers Merge once two applications are selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');
    expect(screen.queryByText(/selected$/)).toBeNull();
    await select(user, 'Acme - Senior Engineer');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
    await select(user, 'acme - Engineer (React)');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText(/selected$/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select Acme - Senior Engineer' })).not.toBeChecked();
  });

  it('preselects the furthest stage and warns only when companies differ', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');
    await select(user, 'acme - Engineer (React)');
    await select(user, 'Acme - Senior Engineer');
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Merge 2 applications' }));
    expect(dialog.getByRole('radio', { name: /^Acme - Senior Engineer/ })).toBeChecked();
    expect(dialog.getByRole('radio', { name: /^acme - Engineer \(React\)/ })).not.toBeChecked();
    expect(dialog.queryByText(/name different companies/)).toBeNull();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    await select(user, 'Initech - SRE');
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    const three = within(await screen.findByRole('dialog', { name: 'Merge 3 applications' }));
    expect(three.getByText('These applications name different companies: Initech, acme.')).toBeInTheDocument();
  });

  it('does nothing when the dialog is cancelled', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');
    await select(user, 'acme - Engineer (React)');
    await select(user, 'Acme - Senior Engineer');
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Merge 2 applications' })).getByRole('button', { name: 'Cancel' }));
    expect(client.mergeApplications).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(3);
  });

  it('merges into the chosen application, removes the others and says so', async () => {
    const user = userEvent.setup();
    const kept = { ...apps[1]!, notes: 'joined', history: [], aliases: [{ company: 'Acme', role: 'Senior Engineer' }] };
    vi.mocked(client.mergeApplications).mockResolvedValue(kept as never);
    renderPage();
    await screen.findByText('Initech');
    await select(user, 'acme - Engineer (React)');
    await select(user, 'Acme - Senior Engineer');
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Merge 2 applications' }));
    await user.click(dialog.getByRole('radio', { name: /^acme - Engineer \(React\)/ }));
    await user.click(dialog.getByRole('button', { name: 'Merge applications' }));
    expect(client.mergeApplications).toHaveBeenCalledWith('pf1', 'a2', ['a1']);
    expect(await screen.findByText('Merged 2 applications into acme - Engineer (React).')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rows()).toEqual(['SRE', 'Engineer (React)']);
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('announces the selected count and clears the merged line on the next selection', async () => {
    const user = userEvent.setup();
    const kept = { ...apps[1]!, history: [], aliases: [] };
    vi.mocked(client.mergeApplications).mockResolvedValue(kept as never);
    renderPage();
    await screen.findByText('Initech');
    await select(user, 'acme - Engineer (React)');
    expect(screen.getByText('1 selected')).toHaveAttribute('role', 'status');
    await select(user, 'Acme - Senior Engineer');
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Merge 2 applications' })).getByRole('button', { name: 'Merge applications' }));
    expect(await screen.findByText(/^Merged 2 applications into/)).toBeInTheDocument();
    await select(user, 'Initech - SRE');
    expect(screen.queryByText(/^Merged 2 applications into/)).toBeNull();
  });

  it('shows a failed merge in the dialog and keeps every row', async () => {
    const user = userEvent.setup();
    vi.mocked(client.mergeApplications).mockRejectedValue(new Error('A Gmail sync of this profile is queued or running; wait for it to finish'));
    renderPage();
    await screen.findByText('Initech');
    await select(user, 'acme - Engineer (React)');
    await select(user, 'Acme - Senior Engineer');
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Merge 2 applications' }));
    await user.click(dialog.getByRole('button', { name: 'Merge applications' }));
    expect(await dialog.findByText('A Gmail sync of this profile is queued or running; wait for it to finish')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(rows()).toHaveLength(3);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('drops selected rows that a filter hides', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');
    await select(user, 'Initech - SRE');
    await select(user, 'Acme - Senior Engineer');
    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'Initech');
    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
  });
});
