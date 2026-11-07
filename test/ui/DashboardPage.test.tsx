import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../../src/ui/pages/DashboardPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';
import { DEFAULT_SETTINGS } from '../../src/server/db/settings-repo.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listApplications: vi.fn(),
  listProposals: vi.fn(),
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

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.listApplications).mockResolvedValue([{}, {}] as never);
  vi.mocked(client.listProposals).mockResolvedValue([{}, {}, {}] as never);
  vi.mocked(client.listJobs).mockResolvedValue([{}, {}, {}, {}] as never);
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
  it('renders the three counts', async () => {
    renderPage();
    expect(await screen.findByTestId('count-applications')).toHaveTextContent('2');
    expect(screen.getByTestId('count-proposals')).toHaveTextContent('3');
    expect(screen.getByTestId('count-jobs')).toHaveTextContent('4');
    expect(screen.getByText(/Last discovery: never/)).toBeInTheDocument();
    expect(screen.getByText(/Last sync: never/)).toBeInTheDocument();
  });

  it('renders what loaded when one fetch fails', async () => {
    vi.mocked(client.listJobs).mockRejectedValue(new Error('jobs down'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('jobs down');
    expect(screen.getByTestId('count-applications')).toHaveTextContent('2');
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
    await user.click(await screen.findByRole('button', { name: 'Max-effort search' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Start a Max-effort search?' });
    return { user, dialog };
  }

  it('Find jobs starts a default discovery run', async () => {
    vi.mocked(client.startDiscovery).mockResolvedValue({ id: 'run-default' } as never);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Find jobs' }));
    expect(client.startDiscovery).toHaveBeenCalledWith('pf1');
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

  it('Max-effort search warns first and starts nothing until confirmed', async () => {
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

  it('turns the Max-effort button off while a run is starting', async () => {
    vi.mocked(client.startDiscovery).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderPage();
    const max = await screen.findByRole('button', { name: 'Max-effort search' });
    expect(max).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Find jobs' }));
    expect(max).toBeDisabled();
  });
});

