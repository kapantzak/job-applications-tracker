import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsPage } from '../../src/ui/pages/JobsPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';
import { DEFAULT_SETTINGS } from '../../src/server/db/settings-repo.js';
import type { JobListItem, Run } from '../../src/server/domain/types.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listJobs: vi.fn(),
  saveJob: vi.fn(),
  markApplied: vi.fn(),
  dismissJob: vi.fn(),
  startDiscovery: vi.fn(),
  getSettings: vi.fn(),
  listRuns: vi.fn(),
}));

function job(over: Partial<JobListItem>): JobListItem {
  return {
    id: 'j1',
    run_id: 'r1',
    company: 'Acme',
    title: 'Engineer',
    location: 'Remote',
    remote: 'remote',
    url: 'https://acme.test/job',
    canonical_url: 'https://acme.test/job',
    source_site: 'acme.test',
    posted_at: null,
    salary: null,
    description_excerpt: null,
    match_reason: null,
    fit_checks: null,
    verification_status: 'ok',
    verified_at: null,
    dedupe_key: 'k',
    dismissed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    application_status: null,
    ...over,
  } as JobListItem;
}

const unverified = job({ id: 'j1', company: 'Acme', verification_status: 'unverified' });
const dead = job({ id: 'j2', company: 'Deadco', verification_status: 'dead' });

function renderPage() {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={['/profiles/platform-roles/jobs']}>
        <Routes>
          <Route path="/profiles/:profileSlug/jobs" element={<JobsPage />} />
          <Route path="/profiles/:profileSlug/runs/:id" element={<p>Run page</p>} />
        </Routes>
      </MemoryRouter>
    </InProfile>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.listJobs).mockImplementation(async (_profileId, f) => (f?.includeDead ? [unverified, dead] : [unverified]));
});

describe('JobsPage', () => {
  it('shows an unverified job and hides dead jobs by default', async () => {
    renderPage();
    expect(await screen.findByText('Could not verify')).toBeInTheDocument();
    expect(client.listJobs).toHaveBeenCalledWith('pf1', { includeDead: false, includeDismissed: false });
    expect(screen.queryByText('Deadco')).not.toBeInTheDocument();
  });

  it('marks a job applied and replaces its buttons', async () => {
    const user = userEvent.setup();
    vi.mocked(client.markApplied).mockResolvedValue({ status: 'applied' } as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Mark applied' }));
    expect(client.markApplied).toHaveBeenCalledWith('pf1', 'j1');
    expect(await screen.findByText('Applied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark applied' })).not.toBeInTheDocument();
  });

  it('shows Saved but keeps Mark applied, then Applied after marking the same row', async () => {
    const user = userEvent.setup();
    vi.mocked(client.saveJob).mockResolvedValue({ status: 'saved' } as never);
    vi.mocked(client.markApplied).mockResolvedValue({ status: 'applied' } as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark applied' }));
    expect(await screen.findByText('Applied')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark applied' })).not.toBeInTheDocument();
  });

  it('shows the persisted application status on load and hides Save and Mark applied', async () => {
    vi.mocked(client.listJobs).mockResolvedValue([
      job({ id: 'j4', company: 'Keepco', application_status: 'interview' }),
      job({ id: 'j5', company: 'Savedco', application_status: 'saved' }),
      job({ id: 'j6', company: 'Noreply', application_status: 'no_response' }),
    ]);
    renderPage();
    expect(await screen.findByText('Interview')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('No response')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    // Only the saved row may still be marked applied.
    expect(screen.getAllByRole('button', { name: 'Mark applied' })).toHaveLength(1);
  });

  it('dismisses a job only after confirmation and reloads the list', async () => {
    const user = userEvent.setup();
    vi.mocked(client.dismissJob).mockResolvedValue(undefined);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(client.dismissJob).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog', { name: 'Dismiss this job?' });
    await user.click(within(dialog).getByRole('button', { name: 'Dismiss job' }));
    expect(client.dismissJob).toHaveBeenCalledWith('pf1', 'j1');
    await vi.waitFor(() => expect(client.listJobs).toHaveBeenCalledTimes(2));
  });

  it('keeps the job when the dismiss confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Dismiss this job?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(client.dismissJob).not.toHaveBeenCalled();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('only renders the Open link for http(s) URLs', async () => {
    vi.mocked(client.listJobs).mockResolvedValue([
      job({ id: 'j3', company: 'Evil', url: 'javascript:alert(1)', canonical_url: '' }),
    ]);
    renderPage();
    await screen.findByText('Evil');
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('starts discovery for the profile in the URL and opens its run', async () => {
    const user = userEvent.setup();
    vi.mocked(client.startDiscovery).mockResolvedValue({ id: 'run-9' } as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Find jobs' }));
    expect(await screen.findByText('Run page')).toBeInTheDocument();
    expect(client.startDiscovery).toHaveBeenCalledWith('pf1', 'default');
  });

  it('shows 422 errors from discovery as they are', async () => {
    const user = userEvent.setup();
    vi.mocked(client.startDiscovery).mockRejectedValue(
      new client.ApiError(422, 'Agent "claude" is not installed: Not found on PATH'),
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Find jobs' }));
    expect(await screen.findByText('Agent "claude" is not installed: Not found on PATH')).toBeInTheDocument();
  });

  it('shows a verdict badge per must-have, and a dash for jobs without verdicts', async () => {
    vi.mocked(client.listJobs).mockResolvedValue([
      job({ id: 'j5', company: 'Fitco', fit_checks: { location: 'pass', remote: 'fail', seniority: 'unknown' } }),
      job({ id: 'j6', company: 'Oldco' }),
    ]);
    renderPage();
    const row = (await screen.findByText('Fitco')).closest('tr')!;
    expect(within(row).getByLabelText('Location: matches')).toHaveTextContent('Location ✓');
    expect(within(row).getByLabelText('Remote: does not match')).toHaveTextContent('Remote ✗');
    expect(within(row).getByLabelText('Seniority: not stated')).toHaveTextContent('Seniority ?');
    const old = screen.getByText('Oldco').closest('tr')!;
    expect(within(old).queryByLabelText(/Location:/)).toBeNull();
  });
});

describe('JobsPage max-effort search', () => {
  const lastMax = {
    id: 'run-old',
    kind: 'discover_jobs',
    effort_mode: 'max',
    status: 'succeeded',
    usage_cost_usd: 3.2,
    usage_input_tokens: 2_000_000,
    usage_output_tokens: 40_000,
  } as Run;

  beforeEach(() => {
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
    vi.mocked(client.listRuns).mockResolvedValue([]);
  });

  async function openDialog() {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Choose search mode' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Max effort' }));
    await user.click(screen.getByRole('button', { name: 'Find jobs with max effort' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Start a Max-effort search?' });
    return { user, dialog };
  }

  it('warns before starting and starts nothing until confirmed', async () => {
    const { dialog } = await openDialog();
    expect(client.startDiscovery).not.toHaveBeenCalled();
    expect(
      await within(dialog).findByText(
        'Runs 5 searches by source (Greenhouse, Lever, Ashby, Other ATS and careers pages, Remote and niche boards), up to 3 at a time. Each can run for up to 20 minutes.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/runs on your own Claude Code plan/)).toBeInTheDocument();
    expect(within(dialog).getByText(/can use up your plan's limits/)).toBeInTheDocument();
    expect(within(dialog).getByText("Each search stops when Claude Code's own cost estimate reaches $5.")).toBeInTheDocument();
    expect(within(dialog).getByText('No earlier Max-effort search to compare with.')).toBeInTheDocument();
    expect(client.listRuns).toHaveBeenCalledWith('pf1', 50);
  });

  it('starts a max run on confirm and opens it', async () => {
    vi.mocked(client.startDiscovery).mockResolvedValue({ id: 'run-max' } as never);
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Start Max-effort search' }));
    expect(client.startDiscovery).toHaveBeenCalledWith('pf1', 'max');
    expect(await screen.findByText('Run page')).toBeInTheDocument();
  });

  it('starts nothing when cancelled', async () => {
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(client.startDiscovery).not.toHaveBeenCalled();
  });

  it('quotes what the last max-effort search used', async () => {
    vi.mocked(client.listRuns).mockResolvedValue([
      { ...lastMax, id: 'run-default', effort_mode: 'default', usage_cost_usd: 0.1 } as Run,
      lastMax,
    ]);
    const { dialog } = await openDialog();
    expect(
      await within(dialog).findByText(
        'Your last Max-effort search reported $3.20 estimated · 2.0M tokens in, 40.0k out. A search that times out or is cancelled reports nothing, so the real use can be higher.',
      ),
    ).toBeInTheDocument();
  });

  it('says no spend cap applies for Codex or when the Claude cap is empty', async () => {
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, adapter_id: 'codex' });
    const { user, dialog } = await openDialog();
    expect(await within(dialog).findByText('Codex has no spend cap here; only the time limit stops a search.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    cleanup();
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, claude_max_budget_usd_discover: '' });
    const again = await openDialog();
    expect(
      await within(again.dialog).findByText('No spend cap is set in Settings; only the time limit stops a search.'),
    ).toBeInTheDocument();
  });

  it('words the plan and the cap for a custom agent', async () => {
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, adapter_id: 'custom', custom_command: 'x' });
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText(/It runs on your custom agent's own account/)).toBeInTheDocument();
    expect(within(dialog).getByText('Your custom agent has no spend cap here; only the time limit stops a search.')).toBeInTheDocument();
  });

  it('shows the error when a discovery of the other mode is already running', async () => {
    vi.mocked(client.startDiscovery).mockRejectedValue(new client.ApiError(409, 'A discovery run is already active'));
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Start Max-effort search' }));
    expect(await screen.findByText('A discovery run is already active')).toBeInTheDocument();
  });
});

