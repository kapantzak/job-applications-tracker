import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../../src/ui/pages/DashboardPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';
import type { DashboardResponse } from '../../src/server/domain/dashboard.js';
import type { Application, ApplicationStatus } from '../../src/server/domain/types.js';
import { DEFAULT_SETTINGS } from '../../src/server/db/settings-repo.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  getDashboard: vi.fn(),
  listApplications: vi.fn(),
  listApplicationHistory: vi.fn(),
  listJobs: vi.fn(),
  listRuns: vi.fn(),
  getSettings: vi.fn(),
  startDiscovery: vi.fn(),
  importJobs: vi.fn(),
  getImportPrompt: vi.fn(),
  startSync: vi.fn(),
}));

function renderPage() {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={['/profiles/platform-roles']}>
        <Routes>
          <Route path="/profiles/:profileSlug" element={<DashboardPage />} />
          <Route path="/profiles/:profileSlug/runs/:id" element={<p>Run page</p>} />
          <Route path="/profiles/:profileSlug/applications" element={<ApplicationsProbe />} />
        </Routes>
      </MemoryRouter>
    </InProfile>,
  );
}

// Stands in for the Applications page: shows the query and whether it opened as a one-time view.
function ApplicationsProbe() {
  const location = useLocation();
  return (
    <p data-testid="applications">
      {location.search} {JSON.stringify(location.state)}
    </p>
  );
}

const BASE = '/profiles/platform-roles';
const STORAGE_KEY = 'application-filters:pf1';
// Changed today, so none of them is quiet unless a test says so.
const TODAY = new Date().toISOString();

function makeApp(over: Partial<Application> & { id: string; status: ApplicationStatus }): Application {
  return {
    profile_id: 'pf1',
    job_id: null,
    company: 'Acme',
    role: 'Engineer',
    url: null,
    applied_at: null,
    status_changed_at: TODAY,
    notes: null,
    sender_domains: [],
    created_at: TODAY,
    ...over,
  };
}

// Applications with these statuses, spread over three invented companies; no history, so each
// reached the funnel step of its current status.
function appsOf(mix: Partial<Record<ApplicationStatus, number>>): Application[] {
  const companies = ['Acme', 'Globex', 'Initech'];
  let n = 0;
  return (Object.entries(mix) as [ApplicationStatus, number][]).flatMap(([status, count]) =>
    Array.from({ length: count }, () => {
      n += 1;
      return makeApp({ id: `a${n}`, status, company: companies[n % companies.length]! });
    }),
  );
}

const MIX = { saved: 5, applied: 12, screening: 3, interview: 2, offer: 1, rejected: 6, withdrawn: 2, no_response: 3 };

function summary(over: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    total: 34,
    status_counts: {
      saved: 5,
      applied: 12,
      screening: 3,
      interview: 2,
      offer: 1,
      rejected: 6,
      withdrawn: 2,
      no_response: 3,
    },
    funnel: { applied: 24, screening: 8, interview: 3, offer: 1 },
    stopped_at: {
      applied: { waiting: 9, rejected: 4, no_response: 2, withdrawn: 1 },
      screening: { waiting: 3, rejected: 1, no_response: 1, withdrawn: 0 },
      interview: { waiting: 1, rejected: 1, no_response: 0, withdrawn: 0 },
      offer: { waiting: 1, rejected: 0, no_response: 0, withdrawn: 0 },
    },
    pending_proposals: 3,
    pending_new_applications: 2,
    quiet: [
      { id: 'a1', company: 'Acme', role: 'Engineer', status: 'applied', since: '2026-10-01T00:00:00Z', days: 20 },
      { id: 'a2', company: 'Globex', role: 'Analyst', status: 'screening', since: '2026-10-05T00:00:00Z', days: 16 },
    ],
    quiet_days: 14,
    ...over,
  };
}

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(client.getDashboard).mockResolvedValue(summary());
  vi.mocked(client.listApplications).mockResolvedValue(appsOf(MIX));
  vi.mocked(client.listApplicationHistory).mockResolvedValue([]);
  vi.mocked(client.listJobs).mockResolvedValue([{}, {}, {}] as never);
  vi.mocked(client.listRuns).mockResolvedValue([]);
  vi.mocked(client.getSettings).mockResolvedValue({
    adapter_id: 'claude',
    claude_model_discover: 'opus',
    claude_effort_discover: 'high',
    claude_model_sync: '',
    claude_effort_sync: '',
    codex_model_discover: 'model-a',
  } as never);
});

describe('DashboardPage', () => {
  it('says what the screen shows and explains Find jobs', async () => {
    renderPage();
    await screen.findByTestId('count-in-progress');
    expect(screen.getByText(/^How this profile's applications are doing\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Find jobs' })).toBeInTheDocument();
  });

  it('says what Sync from Gmail searches', async () => {
    renderPage();
    await screen.findByTestId('count-in-progress');
    expect(screen.getByText(/Sync searches by company and job-board senders\./)).toBeInTheDocument();
  });

  it('explains Sync from Gmail next to its button', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'About Sync from Gmail' }));
    expect(await screen.findByRole('dialog', { name: 'About Sync from Gmail' })).toHaveTextContent(
      /nothing changes until you accept/,
    );
  });

  it('tiles show counts and link to matching lists', async () => {
    renderPage();
    const inProgress = await screen.findByTestId('count-in-progress');
    expect(inProgress).toHaveTextContent('17');
    expect(inProgress).toHaveAttribute(
      'href',
      `${BASE}/applications?status=applied&status=screening&status=interview`,
    );
    expect(screen.getByTestId('count-interviews')).toHaveTextContent('2');
    expect(screen.getByTestId('count-interviews')).toHaveAttribute('href', `${BASE}/applications?status=interview`);
    expect(screen.getByTestId('count-offers')).toHaveTextContent('1');
    expect(screen.getByTestId('count-offers')).toHaveAttribute('href', `${BASE}/applications?status=offer`);
    expect(screen.getByTestId('count-rejected')).toHaveTextContent('6');
    expect(screen.getByTestId('count-rejected')).toHaveAttribute('href', `${BASE}/applications?status=rejected`);
    // Status changes and new applications both wait on the Review page (SOW-0045).
    expect(screen.getByTestId('count-proposals')).toHaveTextContent('5');
    expect(screen.getByTestId('count-proposals')).toHaveAttribute('href', `${BASE}/review`);
  });

  it('shows the journey graph with the attention card below it', async () => {
    renderPage();
    const journey = await screen.findByRole('heading', { name: "Your applications' journey" });
    const attention = screen.getByRole('heading', { name: 'Needs attention' });
    expect(journey.compareDocumentPosition(attention) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('discovery line carries the jobs count', async () => {
    renderPage();
    expect(await screen.findByText(/Last job search: .+ · 3 jobs/)).toBeInTheDocument();
    expect(screen.getByText(/Last Gmail sync: never/)).toBeInTheDocument();
  });

  it('discovery line says one job in the singular', async () => {
    vi.mocked(client.listJobs).mockResolvedValue([{}] as never);
    renderPage();
    expect(await screen.findByText(/Last job search: .+ · 1 job$/)).toBeInTheDocument();
  });

  it('drops the jobs suffix and shows an alert when jobs fail to load', async () => {
    vi.mocked(client.listJobs).mockRejectedValue(new Error('jobs down'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('jobs down');
    expect(screen.getByText(/Last job search: never$/)).toBeInTheDocument();
    expect(screen.queryByText(/· \d+ jobs/)).not.toBeInTheDocument();
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('17');
  });

  it('empty profile shows the empty state', async () => {
    vi.mocked(client.getDashboard).mockResolvedValue(
      summary({ total: 0, pending_proposals: 0, pending_new_applications: 0, quiet: [] }),
    );
    vi.mocked(client.listApplications).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No applications yet')).toBeInTheDocument();
    expect(screen.getByText(/or sync from Gmail to find applications you already made/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', `${BASE}/jobs`);
    expect(screen.queryByRole('heading', { name: "Your applications' journey" })).not.toBeInTheDocument();
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('0');
    expect(screen.getByTestId('count-proposals')).toHaveTextContent('0');
    // Nothing to filter yet.
    expect(screen.queryByRole('group', { name: 'Filter applications' })).not.toBeInTheDocument();
  });

  it('points an empty profile to Review when new applications are waiting (decision 17A)', async () => {
    vi.mocked(client.getDashboard).mockResolvedValue(
      summary({ total: 0, pending_proposals: 0, pending_new_applications: 2, quiet: [] }),
    );
    vi.mocked(client.listApplications).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No applications yet')).toBeInTheDocument();
    expect(screen.getByText(/Sync from Gmail found 2 new applications\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review page' })).toHaveAttribute('href', `${BASE}/review`);
    expect(screen.getByTestId('count-proposals')).toHaveTextContent('2');
  });

  it('failed applications still show runs and agent, with one alert for both list requests', async () => {
    vi.mocked(client.listApplications).mockRejectedValue(new Error('Applications failed'));
    vi.mocked(client.listApplicationHistory).mockRejectedValue(new Error('Applications failed'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Applications failed');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('–');
    expect(screen.getByTestId('count-interviews')).toHaveTextContent('–');
    expect(screen.getByTestId('count-proposals')).toHaveTextContent('5');
    expect(screen.getByRole('heading', { name: 'Last successful runs' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.queryByText('No applications yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter applications' })).not.toBeInTheDocument();
  });

  it('a failed history alone also leaves the tiles unavailable', async () => {
    vi.mocked(client.listApplicationHistory).mockRejectedValue(new Error('History failed'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('History failed');
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('–');
    expect(screen.queryByRole('heading', { name: "Your applications' journey" })).not.toBeInTheDocument();
  });

  it('a failed dashboard route leaves only To review unavailable', async () => {
    vi.mocked(client.getDashboard).mockRejectedValue(new Error('Summary failed'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Summary failed');
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('17');
    expect(screen.getByTestId('count-proposals')).toHaveTextContent('–');
    expect(screen.getByRole('heading', { name: "Your applications' journey" })).toBeInTheDocument();
    // Decision 11A: unknown counts are said to be unknown, never "nothing".
    expect(screen.getByText('Waiting proposals could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs you right now.')).not.toBeInTheDocument();
  });

  it('shows the selected agent with its model and effort per run kind', async () => {
    renderPage();
    const card = await screen.findByRole('region', { name: 'Agent' });
    expect(card).toHaveTextContent('Job search: Claude Code · model opus · effort high');
    expect(card).toHaveTextContent('Gmail sync: Claude Code · model Agent default · effort Agent default');
  });

  it('points custom commands to their own flags', async () => {
    vi.mocked(client.getSettings).mockResolvedValue({ adapter_id: 'custom' } as never);
    renderPage();
    const card = await screen.findByRole('region', { name: 'Agent' });
    expect(card).toHaveTextContent('Job search: Custom command · model and effort set in your custom command');
  });
});

describe('DashboardPage search buttons', () => {
  beforeEach(() => {
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
  });

  async function openMaxDialog() {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Choose search mode' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Max effort' }));
    await user.click(screen.getByRole('button', { name: 'Find jobs with max effort' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Start a Max-effort search?' });
    return { user, dialog };
  }

  it('Find jobs starts a default discovery run', async () => {
    vi.mocked(client.startDiscovery).mockResolvedValue({ id: 'run-default' } as never);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Find jobs' }));
    expect(client.startDiscovery).toHaveBeenCalledWith('pf1', 'default');
    expect(await screen.findByText('Run page')).toBeInTheDocument();
  });

  it('a custom search from the Find jobs menu sends its instructions', async () => {
    vi.mocked(client.startDiscovery).mockResolvedValue({ id: 'run-custom' } as never);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Choose search mode' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Custom search…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Custom search' });
    await user.type(within(dialog).getByLabelText('Instructions'), 'Only fintech companies');
    await user.click(within(dialog).getByRole('button', { name: 'Start search' }));
    expect(client.startDiscovery).toHaveBeenCalledWith('pf1', 'default', 'Only fintech companies');
    expect(await screen.findByText('Run page')).toBeInTheDocument();
  });

  it('an import from the Find jobs menu opens its run', async () => {
    vi.mocked(client.importJobs).mockResolvedValue({ id: 'run-import' } as never);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Choose search mode' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Import from another agent…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import from another agent' });
    await user.click(within(dialog).getByLabelText('Agent answer'));
    await user.paste('{"jobs": []}');
    await user.click(within(dialog).getByRole('button', { name: 'Import jobs' }));
    expect(client.importJobs).toHaveBeenCalledWith('pf1', '{"jobs": []}', undefined);
    expect(await screen.findByText('Run page')).toBeInTheDocument();
  });

  it('Sync from Gmail starts a sync run', async () => {
    vi.mocked(client.startSync).mockResolvedValue({ id: 'run-sync' } as never);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Sync from Gmail' }));
    expect(client.startSync).toHaveBeenCalledWith('pf1');
    expect(await screen.findByText('Run page')).toBeInTheDocument();
  });

  it('Find jobs with max effort warns first and starts nothing until confirmed', async () => {
    const { dialog } = await openMaxDialog();
    expect(
      await within(dialog).findByText(
        'Runs 5 searches by source (Greenhouse, Lever, Ashby, Other ATS and careers pages, Remote and niche boards), up to 3 at a time. Each can run for up to 20 minutes.',
      ),
    ).toBeInTheDocument();
    expect(client.startDiscovery).not.toHaveBeenCalled();
  });

  it('starts a max run on confirm and opens it', async () => {
    vi.mocked(client.startDiscovery).mockResolvedValue({ id: 'run-max' } as never);
    const { user, dialog } = await openMaxDialog();
    await user.click(await within(dialog).findByRole('button', { name: 'Start Max-effort search' }));
    expect(client.startDiscovery).toHaveBeenCalledWith('pf1', 'max');
    expect(await screen.findByText('Run page')).toBeInTheDocument();
  });

  it('starts nothing when the max dialog is cancelled', async () => {
    const { user, dialog } = await openMaxDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(client.startDiscovery).not.toHaveBeenCalled();
  });

  it('turns both parts of the split button off while a run is starting', async () => {
    vi.mocked(client.startDiscovery).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderPage();
    const find = await screen.findByRole('button', { name: 'Find jobs' });
    const modes = screen.getByRole('button', { name: 'Choose search mode' });
    expect(modes).toBeEnabled();
    await user.click(find);
    expect(find).toBeDisabled();
    expect(modes).toBeDisabled();
  });
});

// Journey is the only view (SOW-0052): no switch, no stored choice, no count or width rule.
describe('DashboardPage journey view', () => {
  const journeyHeading = () => screen.findByRole('heading', { name: "Your applications' journey" });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows Journey for a single sent application, with no view switch', async () => {
    vi.mocked(client.listApplications).mockResolvedValue(appsOf({ applied: 1 }));
    renderPage();
    expect(await journeyHeading()).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Dashboard view' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Breakdown' })).not.toBeInTheDocument();
  });

  // Nothing reads the width now; this fails if a width rule that hides Journey comes back.
  it('shows Journey in a window narrower than 1280 px', async () => {
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
    );
    renderPage();
    expect(await journeyHeading()).toBeInTheDocument();
  });

  it('ignores a view choice stored by an earlier version', async () => {
    localStorage.setItem('dashboard-view', 'breakdown');
    renderPage();
    expect(await journeyHeading()).toBeInTheDocument();
    expect(localStorage.getItem('dashboard-view')).toBe('breakdown');
  });

  it('shows Journey with nothing sent but saved applications (SOW-0052 Decision 2)', async () => {
    vi.mocked(client.listApplications).mockResolvedValue(appsOf({ saved: 2 }));
    renderPage();
    expect(await journeyHeading()).toBeInTheDocument();
    expect(screen.getByText('0 sent · 2 saved, not applied yet')).toBeInTheDocument();
    const graph = screen.getByRole('img', { name: '0 sent.' });
    expect([...graph.querySelectorAll('[data-part="count"]')].map((t) => t.textContent)).toEqual(['0', '0', '0', '0']);
    expect(graph.querySelectorAll('[data-part="node"], [data-part="moved"], [data-exit]')).toHaveLength(0);
  });
});

// The Applications filters on the Dashboard, shared through localStorage (SOW-0054).
describe('DashboardPage filters', () => {
  const toolbar = () => screen.getByRole('group', { name: 'Filter applications' });
  const DAYS_AGO_30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const apps = [
    makeApp({ id: 'a1', company: 'Acme', role: 'Platform Engineer', status: 'interview' }),
    makeApp({ id: 'a2', company: 'Acme', role: 'SRE', status: 'rejected' }),
    makeApp({ id: 'a3', company: 'Globex', role: 'Data Engineer', status: 'applied', status_changed_at: DAYS_AGO_30 }),
    makeApp({ id: 'a4', company: 'Initech', role: 'SRE', status: 'offer' }),
    makeApp({ id: 'a5', company: 'Initech', role: 'Analyst', status: 'saved' }),
  ];

  beforeEach(() => {
    vi.mocked(client.listApplications).mockResolvedValue(apps);
    // a1 went through screening before its interview; a2 was rejected after screening.
    vi.mocked(client.listApplicationHistory).mockResolvedValue([
      { application_id: 'a1', from_status: 'applied', to_status: 'screening', changed_at: '2026-11-02T10:00:00Z' },
      { application_id: 'a1', from_status: 'screening', to_status: 'interview', changed_at: '2026-11-05T10:00:00Z' },
      { application_id: 'a2', from_status: 'screening', to_status: 'rejected', changed_at: '2026-11-06T10:00:00Z' },
    ]);
  });

  async function pickCompany(user: ReturnType<typeof userEvent.setup>, company: string) {
    await user.click(within(toolbar()).getByRole('button', { name: 'Filter by company' }));
    const dialog = await screen.findByRole('dialog', { name: 'Filter by company' });
    await user.click(within(dialog).getByRole('checkbox', { name: new RegExp(`^${company}`) }));
    await user.keyboard('{Escape}');
  }

  it('shows the Applications filter bar above the tiles with the shown count', async () => {
    renderPage();
    const tile = await screen.findByTestId('count-in-progress');
    const bar = toolbar();
    expect(bar.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of ['Search applications', 'Filter by company', 'Filter by role', 'Filter by status', 'Filter by applied from', 'Filter by applied to']) {
      expect(within(bar).getByRole(name.startsWith('Search') ? 'searchbox' : 'button', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Showing 5 of 5 applications')).toBeInTheDocument();
  });

  it('filters the tiles, the journey and the quiet list, and leaves To review alone', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByTestId('count-in-progress')).toHaveTextContent('2');
    expect(screen.getByText('Globex · Data Engineer')).toBeInTheDocument();

    await pickCompany(user, 'Acme');
    expect(screen.getByText('Showing 2 of 5 applications')).toBeInTheDocument();
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('1');
    expect(screen.getByTestId('count-interviews')).toHaveTextContent('1');
    expect(screen.getByTestId('count-offers')).toHaveTextContent('0');
    expect(screen.getByTestId('count-rejected')).toHaveTextContent('1');
    expect(screen.getByTestId('count-proposals')).toHaveTextContent('5');
    // Both Acme applications reached screening through their history.
    expect(screen.getByText('2 sent')).toBeInTheDocument();
    const graph = screen.getByRole('img', { name: /^2 sent\./ });
    expect([...graph.querySelectorAll('[data-part="count"]')].map((t) => t.textContent)).toEqual(['2', '2 · 100%', '1 · 50%', '0 · 0%']);
    expect(screen.queryByText('Globex · Data Engineer')).not.toBeInTheDocument();
    expect(screen.getByText('3 status proposals waiting')).toBeInTheDocument();
  });

  it('saves the filters for the profile and loads them on the next visit', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();
    await screen.findByTestId('count-in-progress');
    await pickCompany(user, 'Initech');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('company=Initech');
    unmount();

    renderPage();
    expect(await screen.findByText('Showing 2 of 5 applications')).toBeInTheDocument();
    expect(screen.getByTestId('count-offers')).toHaveTextContent('1');
    expect(within(toolbar()).getByRole('button', { name: 'Filter by company: Initech' })).toBeInTheDocument();
  });

  it('drops stored values that are not a filter of this table', async () => {
    localStorage.setItem(STORAGE_KEY, 'status=interview&bogus=1&applied=not-a-range&sort=nope');
    renderPage();
    expect(await screen.findByText('Showing 1 of 5 applications')).toBeInTheDocument();
    expect(within(toolbar()).queryByRole('button', { name: /^Filter by applied from:/ })).not.toBeInTheDocument();
  });

  it('links each tile to Applications with the filters and the tile status, as a one-time view', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, 'company=Acme&sort=-applied');
    renderPage();
    const tile = await screen.findByTestId('count-interviews');
    expect(tile).toHaveAttribute('href', `${BASE}/applications?sort=-applied&company=Acme&status=interview`);
    expect(screen.getByTestId('count-in-progress')).toHaveAttribute(
      'href',
      `${BASE}/applications?sort=-applied&company=Acme&status=applied&status=screening&status=interview`,
    );
    await user.click(tile);
    expect(await screen.findByTestId('applications')).toHaveTextContent(
      '?sort=-applied&company=Acme&status=interview {"oneTimeView":true}',
    );
    // A tile click is not a filter change.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('company=Acme&sort=-applied');
  });

  it('narrows a tile to the statuses the status filter keeps, and shows no link when it keeps none', async () => {
    localStorage.setItem(STORAGE_KEY, 'status=applied&status=rejected');
    renderPage();
    expect(await screen.findByTestId('count-in-progress')).toHaveAttribute('href', `${BASE}/applications?status=applied`);
    expect(screen.getByTestId('count-rejected')).toHaveAttribute('href', `${BASE}/applications?status=rejected`);
    const interviews = screen.getByTestId('count-interviews');
    expect(interviews).toHaveTextContent('0');
    expect(interviews).not.toHaveAttribute('href');
    expect(screen.getByTestId('count-proposals')).toHaveAttribute('href', `${BASE}/review`);
  });

  it('shows no matches in place of Journey only, keeps the proposal lines, and Clear filters brings everything back', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, 'q=nothing-matches&sort=company');
    renderPage();
    expect(await screen.findByText('No rows match your filters')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "Your applications' journey" })).not.toBeInTheDocument();
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('0');
    expect(screen.getByTestId('count-proposals')).toHaveTextContent('5');
    // Decision 10A: waiting proposals ignore the filters, so Needs attention stays.
    const attention = screen.getByRole('list', { name: 'Needs attention' });
    expect(within(attention).getByRole('link', { name: '3 status proposals waiting' })).toHaveAttribute('href', `${BASE}/review`);
    expect(within(attention).getByRole('link', { name: '2 new applications found' })).toBeInTheDocument();
    expect(within(attention).queryByText('Globex · Data Engineer')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: "Your applications' journey" })).toBeInTheDocument();
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('2');
    // Reset keeps the sort, as on the Applications page.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('sort=company');
  });

  it('keeps quiet applications with the same age in newest-first order whatever the saved sort', async () => {
    vi.mocked(client.listApplications).mockResolvedValue([
      makeApp({ id: 'q1', company: 'Zeta Labs', status: 'applied', status_changed_at: DAYS_AGO_30 }),
      makeApp({ id: 'q2', company: 'Acme', status: 'applied', status_changed_at: DAYS_AGO_30 }),
    ]);
    localStorage.setItem(STORAGE_KEY, 'sort=company');
    renderPage();
    const list = await screen.findByRole('list', { name: 'Needs attention' });
    const links = within(list).getAllByRole('link').map((l) => l.textContent);
    expect(links.filter((t) => t!.includes(' · '))).toEqual(['Zeta Labs · Engineer', 'Acme · Engineer']);
  });

  it('keeps filters per profile', async () => {
    localStorage.setItem('application-filters:other-profile', 'company=Acme');
    renderPage();
    expect(await screen.findByText('Showing 5 of 5 applications')).toBeInTheDocument();
  });

  it('still works when localStorage throws', async () => {
    const user = userEvent.setup();
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      renderPage();
      await screen.findByTestId('count-in-progress');
      await pickCompany(user, 'Acme');
      expect(screen.getByText('Showing 2 of 5 applications')).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
