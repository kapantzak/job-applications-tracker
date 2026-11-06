import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsPage } from '../../src/ui/pages/RunsPage.js';
import * as client from '../../src/ui/api/client.js';
import type { Run } from '../../src/server/domain/types.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listRuns: vi.fn(),
  cancelRun: vi.fn(),
}));

function makeRun(id: string, status: Run['status'], kind: Run['kind'] = 'discover_jobs'): Run {
  return {
    id,
    kind,
    status,
    started_at: status === 'queued' ? null : '2026-01-01T00:00:00Z',
    finished_at: null,
    adapter_id: 'claude',
    prompt_version: null,
    agent_model: '',
    agent_effort: '',
    agent_model_reported: null,
    summary: null,
    error: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const running = makeRun('run-1', 'running');
const queued = makeRun('run-2', 'queued', 'sync_mail');
const done = { ...makeRun('run-3', 'succeeded'), summary: '2 new' };

function renderPage() {
  return render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>,
  );
}

// Rows are found through their run link: several rows can share a kind.
const rowOf = (id: string) =>
  (screen.getAllByRole('link').find((l) => l.getAttribute('href') === `/runs/${id}`) as HTMLElement).closest(
    'tr',
  ) as HTMLElement;

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.listRuns).mockResolvedValue([running, queued, done]);
});

describe('RunsPage cancel', () => {
  it('offers Cancel only on queued and running rows', async () => {
    renderPage();
    await screen.findByText('2 new');
    expect(screen.getAllByRole('button', { name: 'Cancel run' })).toHaveLength(2);
    expect(within(rowOf('run-3')).queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  });

  it('cancels a queued run after confirmation and refreshes the list', async () => {
    const user = userEvent.setup();
    vi.mocked(client.cancelRun).mockResolvedValue({ ...queued, status: 'aborted', error: 'Cancelled by user' });
    renderPage();
    await screen.findByText('2 new');
    const row = rowOf('run-2');
    vi.mocked(client.listRuns).mockResolvedValue([
      running,
      { ...queued, status: 'aborted', error: 'Cancelled by user' },
      done,
    ]);
    await user.click(within(row).getByRole('button', { name: 'Cancel run' }));
    // Nothing happens until the dialog is confirmed.
    expect(client.cancelRun).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this run?' });
    expect(dialog).toHaveTextContent('The agent is stopped and nothing from this run is saved.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(client.cancelRun).toHaveBeenCalledWith('run-2');
    expect(await within(rowOf('run-2')).findByText('Cancelled by user')).toBeInTheDocument();
    expect(within(rowOf('run-2')).queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  });

  it('keeps the run when the dialog is dismissed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('2 new');
    await user.click(within(rowOf('run-1')).getByRole('button', { name: 'Cancel run' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this run?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep running' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(client.cancelRun).not.toHaveBeenCalled();
  });

  it('shows the server refusal above the list and refreshes the rows', async () => {
    const user = userEvent.setup();
    vi.mocked(client.cancelRun).mockRejectedValue(
      new client.ApiError(409, 'This run is saving its results and can no longer be cancelled'),
    );
    renderPage();
    await screen.findByText('2 new');
    vi.mocked(client.listRuns).mockResolvedValue([{ ...running, status: 'succeeded', summary: '3 new' }, queued, done]);
    await user.click(within(rowOf('run-1')).getByRole('button', { name: 'Cancel run' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this run?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This run is saving its results and can no longer be cancelled',
    );
    expect(await within(rowOf('run-1')).findByText('3 new')).toBeInTheDocument();
    expect(within(rowOf('run-1')).queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  });

  it('polls a cancelled running run until it has ended, then stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      vi.mocked(client.cancelRun).mockResolvedValue(running);
      renderPage();
      await screen.findByText('2 new');
      await user.click(within(rowOf('run-1')).getByRole('button', { name: 'Cancel run' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this run?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
      expect(await within(rowOf('run-1')).findByRole('button', { name: 'Cancelling…' })).toBeDisabled();
      const callsWhileRunning = vi.mocked(client.listRuns).mock.calls.length;

      vi.mocked(client.listRuns).mockResolvedValue([
        { ...running, status: 'aborted', error: 'Cancelled by user' },
        queued,
        done,
      ]);
      await act(async () => vi.advanceTimersByTime(1000));
      expect(await within(rowOf('run-1')).findByText('Cancelled by user')).toBeInTheDocument();
      const callsAfterEnd = vi.mocked(client.listRuns).mock.calls.length;
      expect(callsAfterEnd).toBe(callsWhileRunning + 1);
      await act(async () => vi.advanceTimersByTime(3000));
      expect(vi.mocked(client.listRuns).mock.calls.length).toBe(callsAfterEnd);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling when the page is left', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      vi.mocked(client.cancelRun).mockResolvedValue(running);
      const { unmount } = renderPage();
      await screen.findByText('2 new');
      await user.click(within(rowOf('run-1')).getByRole('button', { name: 'Cancel run' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this run?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
      await screen.findByRole('button', { name: 'Cancelling…' });
      unmount();
      const calls = vi.mocked(client.listRuns).mock.calls.length;
      await act(async () => vi.advanceTimersByTime(5000));
      expect(vi.mocked(client.listRuns).mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a refresh failure above the list without hiding it', async () => {
    const user = userEvent.setup();
    vi.mocked(client.cancelRun).mockResolvedValue(running);
    renderPage();
    await screen.findByText('2 new');
    vi.mocked(client.listRuns).mockRejectedValue(new Error('server down'));
    await user.click(within(rowOf('run-1')).getByRole('button', { name: 'Cancel run' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this run?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('server down');
    expect(screen.getByText('2 new')).toBeInTheDocument();
  });
});
