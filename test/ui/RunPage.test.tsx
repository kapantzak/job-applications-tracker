import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunPage } from '../../src/ui/pages/RunPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';
import type { Run } from '../../src/server/domain/types.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  getRun: vi.fn(),
  getRunLog: vi.fn(),
  subscribeRunEvents: vi.fn(),
  cancelRun: vi.fn(),
}));

const run: Run = {
  id: 'r1',
  profile_id: 'pf1',
  kind: 'discover_jobs',
  status: 'running',
  started_at: '2026-01-01T00:00:00Z',
  finished_at: null,
  adapter_id: 'claude',
  prompt_version: null,
  agent_model: 'opus',
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

function renderPage() {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={['/profiles/platform-roles/runs/r1']}>
        <Routes>
          <Route path="/profiles/:profileSlug/runs/:id" element={<RunPage />} />
        </Routes>
      </MemoryRouter>
    </InProfile>,
  );
}

afterEach(cleanup);

// The value shown next to a run detail label.
const detail = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent;

describe('RunPage', () => {
  let onLine: (l: string) => void;
  let onDone: (s: never) => void;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(client.getRun).mockResolvedValue(run);
    vi.mocked(client.subscribeRunEvents).mockImplementation((_profileId, _id, l, d) => {
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
    expect(screen.getByRole('link', { name: 'View jobs' })).toHaveAttribute('href', '/profiles/platform-roles/jobs');
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
    expect(await screen.findByRole('link', { name: 'View jobs' })).toHaveAttribute('href', '/profiles/platform-roles/jobs');
  });

  it('shows the agent, the requested model and effort, and the model the agent reported', async () => {
    vi.mocked(client.getRun).mockResolvedValue({
      ...run,
      status: 'succeeded',
      agent_model: '',
      agent_effort: 'high',
      agent_model_reported: 'model-a',
    });
    vi.mocked(client.getRunLog).mockResolvedValue('');
    renderPage();
    await screen.findByText(/discover_jobs/);
    expect(detail('Agent')).toBe('claude');
    expect(detail('Model')).toBe('Agent defaultran as model-a');
    expect(detail('Effort')).toBe('high');
  });

  it('shows the effort mode and the usage the agent reported for a max discovery', async () => {
    vi.mocked(client.getRun).mockResolvedValue({
      ...run,
      status: 'succeeded',
      effort_mode: 'max',
      usage_cost_usd: 2.5,
      usage_input_tokens: 120_000,
      usage_output_tokens: 900,
    });
    vi.mocked(client.getRunLog).mockResolvedValue('');
    renderPage();
    await screen.findByText(/discover_jobs/);
    expect(detail('Mode')).toBe('Max effort');
    expect(detail('Usage')).toBe('$2.50 estimated · 120.0k tokens in, 900 out');
  });

  it('says when a discovery reported no usage', async () => {
    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'succeeded' });
    vi.mocked(client.getRunLog).mockResolvedValue('');
    renderPage();
    await screen.findByText(/discover_jobs/);
    expect(detail('Mode')).toBe('Default');
    expect(detail('Usage')).toBe('Not reported');
  });

  it('shows no mode and no usage for a sync run, which records none', async () => {
    vi.mocked(client.getRun).mockResolvedValue({ ...run, kind: 'sync_mail', status: 'succeeded' });
    vi.mocked(client.getRunLog).mockResolvedValue('');
    renderPage();
    await screen.findByText(/sync_mail/);
    expect(screen.queryByText('Mode', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('Usage', { selector: 'dt' })).toBeNull();
  });

  it('marks model and effort as not recorded for older runs and as custom for custom commands', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue('');
    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'succeeded', agent_model: null, agent_effort: null });
    const { unmount } = renderPage();
    await screen.findByText(/discover_jobs/);
    expect(detail('Model')).toBe('Not recorded');
    expect(detail('Effort')).toBe('Not recorded');
    unmount();

    vi.mocked(client.getRun).mockResolvedValue({
      ...run,
      status: 'succeeded',
      adapter_id: 'custom',
      agent_model: null,
      agent_effort: null,
    });
    renderPage();
    await screen.findByText(/discover_jobs/);
    expect(detail('Model')).toBe('Set in your custom command');
    expect(detail('Effort')).toBe('Set in your custom command');
  });

  it('shows pending agent details on a live run and refreshes them when the agent starts', async () => {
    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'queued', adapter_id: '', agent_model: null, agent_effort: null });
    renderPage();
    await screen.findByText(/discover_jobs/);
    expect(detail('Agent')).toBe('Pending');
    expect(detail('Model')).toBe('Pending');
    expect(detail('Effort')).toBe('Pending');

    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'running', agent_model: 'opus', agent_effort: 'high' });
    await act(async () => onLine('Using adapter claude'));
    expect(await screen.findByText('opus')).toBeInTheDocument();
    expect(detail('Effort')).toBe('high');
    expect(client.getRun).toHaveBeenCalledTimes(2);
    // Later lines do not fetch again.
    await act(async () => onLine('Using adapter claude'));
    expect(client.getRun).toHaveBeenCalledTimes(2);
  });

  it('cancels a running run after confirmation and shows Cancelling until it ends', async () => {
    const user = userEvent.setup();
    vi.mocked(client.cancelRun).mockResolvedValue(run);
    renderPage();
    await screen.findByText(/discover_jobs/);
    await user.click(screen.getByRole('button', { name: 'Cancel run' }));
    expect(client.cancelRun).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this run?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(client.cancelRun).toHaveBeenCalledWith('pf1', 'r1');
    expect(await screen.findByRole('button', { name: 'Cancelling…' })).toBeDisabled();

    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'aborted', error: 'Cancelled by user' });
    await act(async () => onDone('aborted' as never));
    expect(await screen.findByText('Cancelled by user')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
  });

  it('turns the control into Saving results once the run starts saving', async () => {
    renderPage();
    await screen.findByText(/discover_jobs/);
    // Agent output that merely starts with the same words must not lock the control.
    await act(async () => onLine('Saving results to output.json'));
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeEnabled();
    await act(async () => onLine('Saving results; the run can no longer be cancelled'));
    expect(screen.getByRole('button', { name: 'Saving results…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  });

  it('shows the cancelled state at once for a queued run', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'queued' });
    vi.mocked(client.cancelRun).mockResolvedValue({ ...run, status: 'aborted', error: 'Cancelled by user' });
    renderPage();
    await screen.findByText(/discover_jobs/);
    await user.click(screen.getByRole('button', { name: 'Cancel run' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this run?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(await screen.findByText('Cancelled by user')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
  });

  it('offers no cancel on a finished run', async () => {
    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'succeeded', summary: 'done' });
    vi.mocked(client.getRunLog).mockResolvedValue('');
    renderPage();
    await screen.findByText('done');
    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
  });

  it('shows readable log rows by default and the raw lines on request', async () => {
    const user = userEvent.setup();
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'platform engineer Lisbon' } }] },
    });
    const hook = JSON.stringify({ type: 'system', subtype: 'hook_started', hook_name: 'h' });
    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'succeeded', summary: 'done' });
    vi.mocked(client.getRunLog).mockResolvedValue(['Using adapter claude', hook, event].join('\n'));
    renderPage();
    const log = await screen.findByRole('list', { name: 'Run log' });
    expect(within(log).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Using adapter claude',
      'Searching the web: platform engineer Lisbon',
    ]);
    expect(screen.queryByText(/hook_started/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Show raw output' }));
    expect(screen.queryByRole('list', { name: 'Run log' })).not.toBeInTheDocument();
    expect(screen.getByText(/"hook_started"/)).toBeInTheDocument();
    expect(screen.getByText(/"WebSearch"/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Show raw output' }));
    expect(screen.getByRole('list', { name: 'Run log' })).toBeInTheDocument();
  });

  it('colours warning rows with the text-only amber', async () => {
    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'succeeded', summary: 'done' });
    vi.mocked(client.getRunLog).mockResolvedValue(
      ['Worker 1 (Greenhouse) started', 'Worker 2 (Lever) failed: Agent run failed: Timed out after 1000 ms'].join('\n'),
    );
    renderPage();
    const log = await screen.findByRole('list', { name: 'Run log' });
    const [started, failed] = within(log).getAllByRole('listitem');
    expect(failed).toHaveTextContent('Worker 2 (Lever) failed');
    expect(failed).toHaveClass('text-warning-text');
    expect(started).not.toHaveClass('text-warning-text');
  });

  it('adds readable rows as lines stream in', async () => {
    renderPage();
    await screen.findByText(/discover_jobs/);
    await act(async () =>
      onLine(JSON.stringify({ type: 'system', subtype: 'init', model: 'model-a' })),
    );
    await act(async () =>
      onLine(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'WebFetch', input: { url: 'https://jobs.example.com/3' } }] },
        }),
      ),
    );
    const log = screen.getByRole('list', { name: 'Run log' });
    expect(within(log).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Agent started (model-a)',
      'Opening https://jobs.example.com/3',
    ]);
  });

  it('says when every line is hidden in the readable view', async () => {
    vi.mocked(client.getRun).mockResolvedValue({ ...run, status: 'succeeded', summary: 'done' });
    vi.mocked(client.getRunLog).mockResolvedValue(JSON.stringify({ type: 'system', subtype: 'hook_started' }));
    renderPage();
    expect(await screen.findByText('Nothing readable to show. Turn on raw output to see everything.')).toBeInTheDocument();
  });
});
