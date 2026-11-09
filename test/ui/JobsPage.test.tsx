import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

function SearchProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderPage(search = '') {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={[`/profiles/platform-roles/jobs${search}`]}>
        <SearchProbe />
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

  it('explains the dead-link and dismissed filters', async () => {
    renderPage();
    await screen.findByText('Could not verify');
    expect(screen.getByRole('checkbox', { name: 'Show dead links' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Show dead links' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Show dismissed' })).toBeInTheDocument();
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
    expect(within(dialog).getByText('No earlier complete Max-effort search to compare with.')).toBeInTheDocument();
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
        'Your last complete Max-effort search reported $3.20 estimated · 2.0M tokens in, 40.0k out.',
      ),
    ).toBeInTheDocument();
  });

  it('quotes only complete max-effort searches, never a cancelled, failed or partial one', async () => {
    vi.mocked(client.listRuns).mockResolvedValue([
      { ...lastMax, id: 'run-cancelled', status: 'aborted', usage_cost_usd: 1.2 } as Run,
      { ...lastMax, id: 'run-failed', status: 'failed', usage_cost_usd: 0.4 } as Run,
      {
        ...lastMax,
        id: 'run-partial',
        usage_cost_usd: 2.1,
        summary: '20 new, 0 duplicates, 0 dead, 0 unverified; 2 of 5 workers failed',
      } as Run,
      { ...lastMax, summary: '30 new, 0 duplicates, 1 dead, 0 unverified' } as Run,
    ]);
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText(/Your last complete Max-effort search reported \$3\.20 estimated/)).toBeInTheDocument();
  });

  it('says when there is no complete max-effort search to quote', async () => {
    vi.mocked(client.listRuns).mockResolvedValue([{ ...lastMax, status: 'aborted' } as Run]);
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText('No earlier complete Max-effort search to compare with.')).toBeInTheDocument();
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


describe('JobsPage sorting, search and filters', () => {
  // Server order is newest first.
  const jobs = [
    job({
      id: 'j3',
      company: 'Initech',
      title: 'SRE',
      location: 'Remote',
      source_site: 'boards.example.com',
      created_at: '2026-11-06T10:00:00',
      application_status: 'applied',
    }),
    job({
      id: 'j2',
      company: 'Globex',
      title: 'Data Engineer',
      location: 'Remote',
      source_site: null,
      fit_checks: { location: 'pass', remote: 'pass', seniority: 'pass' },
      created_at: '2026-11-04T10:00:00',
      application_status: 'saved',
    }),
    job({
      id: 'j1',
      company: 'Acme',
      title: 'Platform Engineer',
      location: 'Berlin',
      source_site: 'jobs.example.com',
      fit_checks: { location: 'pass', remote: 'fail', seniority: 'pass' },
      created_at: '2026-11-01T10:00:00',
    }),
  ];
  const companies = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);
  const toolbar = () => screen.getByRole('group', { name: 'Filter jobs' });
  const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(`^${name}`) });

  beforeEach(() => {
    vi.mocked(client.listJobs).mockResolvedValue(jobs);
  });

  it('sorts by a column: ascending, descending, then the default order', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');
    expect(companies()).toEqual(['Initech', 'Globex', 'Acme']);
    expect(header('Company')).toHaveAttribute('aria-sort', 'none');

    await user.click(within(header('Company')).getByRole('button'));
    expect(companies()).toEqual(['Acme', 'Globex', 'Initech']);
    expect(header('Company')).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByTestId('search')).toHaveTextContent('?sort=company');

    await user.click(within(header('Company')).getByRole('button'));
    expect(companies()).toEqual(['Initech', 'Globex', 'Acme']);
    expect(header('Company')).toHaveAttribute('aria-sort', 'descending');

    await user.click(within(header('Found')).getByRole('button'));
    expect(companies()).toEqual(['Acme', 'Globex', 'Initech']);
    expect(header('Company')).toHaveAttribute('aria-sort', 'none');

    await user.click(within(header('Found')).getByRole('button'));
    await user.click(within(header('Found')).getByRole('button'));
    expect(companies()).toEqual(['Initech', 'Globex', 'Acme']);
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();
  });

  it('sorts Fit by the number of passes, with jobs without verdicts last', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');
    await user.click(within(header('Fit')).getByRole('button'));
    expect(companies()).toEqual(['Acme', 'Globex', 'Initech']);
    await user.click(within(header('Fit')).getByRole('button'));
    expect(companies()).toEqual(['Globex', 'Acme', 'Initech']);
  });

  it('searches the text columns and counts what is shown', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');
    expect(screen.getByText('Showing 3 of 3 jobs')).toBeInTheDocument();
    await user.type(within(toolbar()).getByRole('searchbox', { name: 'Search jobs' }), 'engineer');
    expect(companies()).toEqual(['Globex', 'Acme']);
    expect(screen.getByText('Showing 2 of 3 jobs')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search jobs' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search jobs' }), ' berlin');
    expect(companies()).toEqual(['Acme']);
    // A leading space stays in the box while typing; it is not part of the match.
    expect(screen.getByRole('searchbox', { name: 'Search jobs' })).toHaveValue(' berlin');
  });

  it('filters by checked values with counts, and shows the choice on the button', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');
    await user.click(within(toolbar()).getByRole('button', { name: /^Filter by location/ }));
    const popover = await screen.findByRole('dialog', { name: 'Filter by location' });
    const remote = within(popover).getByRole('checkbox', { name: 'Remote' });
    expect(remote.parentElement).toHaveTextContent('Remote2');
    await user.click(remote);
    expect(companies()).toEqual(['Initech', 'Globex']);
    expect(within(toolbar()).getByRole('button', { name: /^Filter by location/ })).toHaveTextContent('Remote');
    await user.click(within(popover).getByRole('checkbox', { name: 'Berlin' }));
    expect(companies()).toEqual(['Initech', 'Globex', 'Acme']);
    expect(within(toolbar()).getByRole('button', { name: 'Filter by location: 2 selected' })).toHaveTextContent('2 selected');
  });

  it('filters by an empty value, the fit summary and the application status', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');

    await user.click(within(toolbar()).getByRole('button', { name: /^Filter by source/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Filter by source' })).getByRole('checkbox', { name: 'No source' }));
    expect(companies()).toEqual(['Globex']);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(within(toolbar()).getByRole('button', { name: /^Filter by fit/ }));
    const fit = await screen.findByRole('dialog', { name: 'Filter by fit' });
    expect(within(fit).getAllByRole('checkbox').map((c) => c.parentElement!.textContent)).toEqual([
      'All match1',
      'Has a mismatch1',
      'No verdict1',
    ]);
    await user.click(within(fit).getByRole('checkbox', { name: 'Has a mismatch' }));
    expect(companies()).toEqual(['Acme']);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(within(toolbar()).getByRole('button', { name: /^Filter by application/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Filter by application' })).getByRole('checkbox', { name: 'Not tracked' }));
    expect(companies()).toEqual(['Acme']);
  });

  it('filters the title by text', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Initech');
    await user.click(within(toolbar()).getByRole('button', { name: /^Filter by title/ }));
    await user.type(await screen.findByRole('textbox', { name: 'Title contains' }), 'data');
    expect(companies()).toEqual(['Globex']);
    expect(screen.getByTestId('search')).toHaveTextContent('?title=data');
  });

  it('filters the Found date with a range picked on the calendar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 9, 12));
    try {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Initech');
      await user.click(within(toolbar()).getByRole('button', { name: /^Filter by found/ }));
      const popover = await screen.findByRole('dialog', { name: 'Filter by found' });
      await user.click(within(popover).getByRole('button', { name: /November 4th, 2026/ }));
      expect(companies()).toEqual(['Globex']);
      await user.click(within(popover).getByRole('button', { name: /November 6th, 2026/ }));
      expect(companies()).toEqual(['Initech', 'Globex']);
      expect(screen.getByTestId('search')).toHaveTextContent('?found=2026-11-04..2026-11-06');
      await user.click(within(popover).getByRole('button', { name: 'Clear' }));
      expect(companies()).toEqual(['Initech', 'Globex', 'Acme']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the view from the URL and keeps it when the list reloads after a dismiss', async () => {
    const user = userEvent.setup();
    vi.mocked(client.dismissJob).mockResolvedValue(undefined);
    renderPage('?q=engineer&sort=company');
    await screen.findByText('Globex');
    expect(companies()).toEqual(['Acme', 'Globex']);
    expect(screen.getByRole('searchbox', { name: 'Search jobs' })).toHaveValue('engineer');
    vi.mocked(client.listJobs).mockResolvedValue(jobs.slice(0, 2));
    await user.click(within(screen.getByText('Acme').closest('tr')!).getByRole('button', { name: 'Dismiss' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Dismiss job' }));
    await vi.waitFor(() => expect(companies()).toEqual(['Globex']));
    expect(screen.getByTestId('search')).toHaveTextContent('?q=engineer&sort=company');
  });

  it('says when nothing matches and clears search and filters, keeping the sort', async () => {
    const user = userEvent.setup();
    renderPage('?q=nothing&company=Acme&sort=-company');
    expect(await screen.findByText('No rows match your filters')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search jobs' })).toHaveValue('nothing');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(companies()).toEqual(['Initech', 'Globex', 'Acme']);
    await vi.waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search jobs' })).toHaveValue(''));
    expect(screen.getByTestId('search')).toHaveTextContent('?sort=-company');
  });
});
