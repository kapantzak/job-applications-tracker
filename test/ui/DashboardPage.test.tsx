import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../../src/ui/pages/DashboardPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';

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
