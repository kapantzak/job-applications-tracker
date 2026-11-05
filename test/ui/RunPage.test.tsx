import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunPage } from '../../src/ui/pages/RunPage.js';
import * as client from '../../src/ui/api/client.js';
import type { Run } from '../../src/server/domain/types.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  getRun: vi.fn(),
  getRunLog: vi.fn(),
  subscribeRunEvents: vi.fn(),
}));

const run: Run = {
  id: 'r1',
  kind: 'discover_jobs',
  status: 'running',
  started_at: '2026-01-01T00:00:00Z',
  finished_at: null,
  adapter_id: 'claude',
  prompt_version: null,
  summary: null,
  error: null,
  created_at: '2026-01-01T00:00:00Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/runs/r1']}>
      <Routes>
        <Route path="/runs/:id" element={<RunPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('RunPage', () => {
  let onLine: (l: string) => void;
  let onDone: (s: never) => void;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(client.getRun).mockResolvedValue(run);
    vi.mocked(client.subscribeRunEvents).mockImplementation((_id, l, d) => {
      onLine = l;
      onDone = d as never;
      return unsubscribe;
    });
  });

  it('appends streamed lines and shows the summary when done', async () => {
    const { unmount } = renderPage();
    await screen.findByText(/discover_jobs/);
    await act(async () => onLine('hello'));
    expect(screen.getByText(/hello/)).toBeInTheDocument();

    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'succeeded', summary: '2 new' });
    await act(async () => onDone('succeeded' as never));
    expect(await screen.findByText('2 new')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View jobs' })).toHaveAttribute('href', '/jobs');
    expect(client.subscribeRunEvents).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('loads the stored log for finished runs without subscribing', async () => {
    vi.mocked(client.getRun).mockResolvedValue({
      ...run,
      kind: 'sync_mail',
      status: 'failed',
      error: 'Your agent has no Gmail tool configured',
    });
    vi.mocked(client.getRunLog).mockResolvedValue('line one\nline two');
    renderPage();
    expect(await screen.findByText(/line two/)).toBeInTheDocument();
    expect(client.subscribeRunEvents).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '/settings');
  });

  it('offers the follow-up link for failed discovery runs too', async () => {
    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'failed', error: 'x' });
    vi.mocked(client.getRunLog).mockResolvedValue('');
    renderPage();
    expect(await screen.findByRole('link', { name: 'View jobs' })).toHaveAttribute('href', '/jobs');
  });
});
