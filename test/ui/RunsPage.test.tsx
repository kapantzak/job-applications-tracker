import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsPage } from '../../src/ui/pages/RunsPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';
import type { Run } from '../../src/server/domain/types.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listRuns: vi.fn(),
  cancelRun: vi.fn(),
}));

function makeRun(id: string, status: Run['status'], kind: Run['kind'] = 'discover_jobs'): Run {
  return {
    id,
    profile_id: 'pf1',
    kind,
    status,
    started_at: status === 'queued' ? null : '2026-01-01T00:00:00Z',
    finished_at: null,
    adapter_id: 'claude',
    prompt_version: null,
    agent_model: '',
    agent_effort: '',
    agent_model_reported: null,
    effort_mode: 'default',
    usage_cost_usd: null,
    usage_input_tokens: null,
    usage_output_tokens: null,
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
    <InProfile>
      <MemoryRouter initialEntries={['/profiles/platform-roles/runs']}>
        <Routes>
          <Route path="/profiles/:profileSlug/runs" element={<RunsPage />} />
        </Routes>
      </MemoryRouter>
    </InProfile>,
  );
}

// Rows are found through their run link: several rows can share a kind.
const rowOf = (id: string) =>
  (screen.getAllByRole('link').find((l) => l.getAttribute('href') === `/profiles/platform-roles/runs/${id}`) as HTMLElement).closest(
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
    expect(client.cancelRun).toHaveBeenCalledWith('pf1', 'run-2');
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

describe('RunsPage sorting and filters', () => {
  const runs = [
    { ...makeRun('run-c', 'running', 'sync_mail'), started_at: '2026-11-06T10:00:00' },
    { ...makeRun('run-b', 'failed'), started_at: '2026-11-04T10:00:00', finished_at: '2026-11-04T10:05:00', error: 'Agent timed out' },
    { ...makeRun('run-a', 'succeeded'), started_at: '2026-11-01T10:00:00', finished_at: '2026-11-01T10:09:00', summary: '4 new jobs' },
  ];
  const order = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => r.querySelector('a')!.getAttribute('href')!.split('/').pop());

  it('asks for the newest 200 runs and says so when that many are loaded', async () => {
    vi.mocked(client.listRuns).mockResolvedValue(Array.from({ length: 200 }, (_, i) => makeRun(`run-${i}`, 'succeeded')));
    renderPage();
    expect(await screen.findByText('Showing 200 of 200 runs. Only the newest 200 runs are loaded')).toBeInTheDocument();
    expect(client.listRuns).toHaveBeenCalledWith('pf1', 200);
  });

  it('does not mention the limit below it', async () => {
    vi.mocked(client.listRuns).mockResolvedValue(runs);
    renderPage();
    expect(await screen.findByText('Showing 3 of 3 runs')).toBeInTheDocument();
  });

  it('sorts by Finished with unfinished runs last, and searches the result', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listRuns).mockResolvedValue(runs);
    renderPage();
    await screen.findByText('4 new jobs');
    await user.click(within(screen.getByRole('columnheader', { name: /^Finished/ })).getByRole('button'));
    expect(order()).toEqual(['run-a', 'run-b', 'run-c']);
    await user.type(screen.getByRole('searchbox', { name: 'Search runs' }), 'timed out');
    expect(order()).toEqual(['run-b']);
  });

  it('filters by kind and status', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listRuns).mockResolvedValue(runs);
    renderPage();
    await screen.findByText('4 new jobs');
    await user.click(within(screen.getByRole('group', { name: 'Filter runs' })).getByRole('button', { name: /^Filter by kind/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Filter by kind' })).getByRole('checkbox', { name: 'discover_jobs' }));
    expect(order()).toEqual(['run-b', 'run-a']);
    await user.keyboard('{Escape}');
    await user.click(within(screen.getByRole('group', { name: 'Filter runs' })).getByRole('button', { name: /^Filter by status/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Filter by status' })).getByRole('checkbox', { name: 'failed' }));
    expect(order()).toEqual(['run-b']);
  });

  it('filters the Started date', async () => {
    vi.mocked(client.listRuns).mockResolvedValue(runs);
    render(
      <InProfile>
        <MemoryRouter initialEntries={['/profiles/platform-roles/runs?started=2026-11-02..2026-11-06']}>
          <Routes>
            <Route path="/profiles/:profileSlug/runs" element={<RunsPage />} />
          </Routes>
        </MemoryRouter>
      </InProfile>,
    );
    await screen.findByText('Agent timed out');
    expect(order()).toEqual(['run-c', 'run-b']);
  });
});
