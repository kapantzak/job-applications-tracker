import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../../src/ui/pages/DashboardPage.js';
import * as client from '../../src/ui/api/client.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listApplications: vi.fn(),
  listProposals: vi.fn(),
  listJobs: vi.fn(),
  listRuns: vi.fn(),
  startDiscovery: vi.fn(),
  startSync: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.listApplications).mockResolvedValue([{}, {}] as never);
  vi.mocked(client.listProposals).mockResolvedValue([{}, {}, {}] as never);
  vi.mocked(client.listJobs).mockResolvedValue([{}, {}, {}, {}] as never);
  vi.mocked(client.listRuns).mockResolvedValue([]);
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
});
