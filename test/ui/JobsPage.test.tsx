import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsPage } from '../../src/ui/pages/JobsPage.js';
import * as client from '../../src/ui/api/client.js';
import type { Job } from '../../src/server/domain/types.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listJobs: vi.fn(),
  saveJob: vi.fn(),
  markApplied: vi.fn(),
  dismissJob: vi.fn(),
  startDiscovery: vi.fn(),
}));

function job(over: Partial<Job>): Job {
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
    verification_status: 'ok',
    verified_at: null,
    dedupe_key: 'k',
    dismissed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Job;
}

const unverified = job({ id: 'j1', company: 'Acme', verification_status: 'unverified' });
const dead = job({ id: 'j2', company: 'Deadco', verification_status: 'dead' });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/jobs']}>
      <Routes>
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/runs/:id" element={<p>Run page</p>} />
        <Route path="/profile" element={<p>Profile page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.listJobs).mockImplementation(async (f) => (f?.includeDead ? [unverified, dead] : [unverified]));
});

describe('JobsPage', () => {
  it('shows an unverified job and hides dead jobs by default', async () => {
    renderPage();
    expect(await screen.findByText('Could not verify')).toBeInTheDocument();
    expect(client.listJobs).toHaveBeenCalledWith({ includeDead: false, includeDismissed: false });
    expect(screen.queryByText('Deadco')).not.toBeInTheDocument();
  });

  it('marks a job applied and replaces its buttons', async () => {
    const user = userEvent.setup();
    vi.mocked(client.markApplied).mockResolvedValue({ status: 'applied' } as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Mark applied' }));
    expect(client.markApplied).toHaveBeenCalledWith('j1');
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

  it('only renders the Open link for http(s) URLs', async () => {
    vi.mocked(client.listJobs).mockResolvedValue([
      job({ id: 'j3', company: 'Evil', url: 'javascript:alert(1)', canonical_url: '' }),
    ]);
    renderPage();
    await screen.findByText('Evil');
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('asks for a profile when discovery returns 422', async () => {
    const user = userEvent.setup();
    vi.mocked(client.startDiscovery).mockRejectedValue(new client.ApiError(422, 'Profile is not set'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Find jobs' }));
    expect(await screen.findByText(/Fill in your profile first/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');
  });

  it('shows other 422 errors from discovery as they are, without the profile prompt', async () => {
    const user = userEvent.setup();
    vi.mocked(client.startDiscovery).mockRejectedValue(
      new client.ApiError(422, 'Agent "claude" is not installed: Not found on PATH'),
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Find jobs' }));
    expect(await screen.findByText('Agent "claude" is not installed: Not found on PATH')).toBeInTheDocument();
    expect(screen.queryByText(/Fill in your profile/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /profile/i })).not.toBeInTheDocument();
  });
});
