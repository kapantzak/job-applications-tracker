import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../../src/ui/pages/DashboardPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';
import type { DashboardSummary } from '../../src/server/domain/dashboard.js';
import { DEFAULT_SETTINGS } from '../../src/server/db/settings-repo.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  getDashboard: vi.fn(),
  listJobs: vi.fn(),
  listRuns: vi.fn(),
  getSettings: vi.fn(),
  startDiscovery: vi.fn(),
  startSync: vi.fn(),
}));

function renderPage() {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={['/profiles/platform-roles']}>
        <Routes>
          <Route path="/profiles/:profileSlug" element={<DashboardPage />} />
          <Route path="/profiles/:profileSlug/runs/:id" element={<p>Run page</p>} />
        </Routes>
      </MemoryRouter>
    </InProfile>,
  );
}

const BASE = '/profiles/platform-roles';
const NO_STOPS = { waiting: 0, rejected: 0, no_response: 0, withdrawn: 0 };

function summary(over: Partial<DashboardSummary> = {}): DashboardSummary {
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
    rejected_at: { applied: 4, screening: 1, interview: 1, offer: 0 },
    stopped_at: {
      applied: { waiting: 9, rejected: 4, no_response: 2, withdrawn: 1 },
      screening: { waiting: 3, rejected: 1, no_response: 1, withdrawn: 0 },
      interview: { waiting: 1, rejected: 1, no_response: 0, withdrawn: 0 },
      offer: { waiting: 1, rejected: 0, no_response: 0, withdrawn: 0 },
    },
    pending_proposals: 3,
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
  vi.resetAllMocks();
  vi.mocked(client.getDashboard).mockResolvedValue(summary());
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
  it('says what Sync from Gmail searches', async () => {
    renderPage();
    await screen.findByTestId('count-in-progress');
    expect(screen.getByText(/Sync searches by company and job-board senders\./)).toBeInTheDocument();
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
    expect(screen.getByTestId('count-proposals')).toHaveTextContent('3');
    expect(screen.getByTestId('count-proposals')).toHaveAttribute('href', `${BASE}/review`);
  });

  it('shows the bar, funnel and attention cards', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Where your 34 applications stand' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How far applications get' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
  });

  it('discovery line carries the jobs count', async () => {
    renderPage();
    expect(await screen.findByText(/Last discovery: .+ · 3 jobs/)).toBeInTheDocument();
    expect(screen.getByText(/Last sync: never/)).toBeInTheDocument();
  });

  it('discovery line says one job in the singular', async () => {
    vi.mocked(client.listJobs).mockResolvedValue([{}] as never);
    renderPage();
    expect(await screen.findByText(/Last discovery: .+ · 1 job$/)).toBeInTheDocument();
  });

  it('drops the jobs suffix and shows an alert when jobs fail to load', async () => {
    vi.mocked(client.listJobs).mockRejectedValue(new Error('jobs down'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('jobs down');
    expect(screen.getByText(/Last discovery: never$/)).toBeInTheDocument();
    expect(screen.queryByText(/· \d+ jobs/)).not.toBeInTheDocument();
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('17');
  });

  it('empty profile shows the empty state', async () => {
    vi.mocked(client.getDashboard).mockResolvedValue(
      summary({
        total: 0,
        status_counts: {
          saved: 0,
          applied: 0,
          screening: 0,
          interview: 0,
          offer: 0,
          rejected: 0,
          withdrawn: 0,
          no_response: 0,
        },
        funnel: { applied: 0, screening: 0, interview: 0, offer: 0 },
        rejected_at: { applied: 0, screening: 0, interview: 0, offer: 0 },
        stopped_at: { applied: NO_STOPS, screening: NO_STOPS, interview: NO_STOPS, offer: NO_STOPS },
        pending_proposals: 0,
        quiet: [],
      }),
    );
    renderPage();
    expect(await screen.findByText('No applications yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', `${BASE}/jobs`);
    expect(screen.queryByText(/Where your/)).not.toBeInTheDocument();
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('0');
    expect(screen.getByTestId('count-proposals')).toHaveTextContent('0');
  });

  it('a failed summary still shows runs and agent', async () => {
    vi.mocked(client.getDashboard).mockRejectedValue(new Error('Summary failed'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Summary failed');
    expect(screen.getByTestId('count-in-progress')).toHaveTextContent('–');
    expect(screen.getByTestId('count-interviews')).toHaveTextContent('–');
    expect(screen.getByRole('heading', { name: 'Last successful runs' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.queryByText('No applications yet')).not.toBeInTheDocument();
  });

  it('shows the selected agent with its model and effort per run kind', async () => {
    renderPage();
    const card = await screen.findByRole('region', { name: 'Agent' });
    expect(card).toHaveTextContent('Discovery: claude · model opus · effort high');
    expect(card).toHaveTextContent('Mail sync: claude · model Agent default · effort Agent default');
  });

  it('points custom commands to their own flags', async () => {
    vi.mocked(client.getSettings).mockResolvedValue({ adapter_id: 'custom' } as never);
    renderPage();
    const card = await screen.findByRole('region', { name: 'Agent' });
    expect(card).toHaveTextContent('Discovery: custom · model and effort set in your custom command');
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

