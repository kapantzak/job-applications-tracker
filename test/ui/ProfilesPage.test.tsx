import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CvAnalysis, Profile, ProfileListItem } from '../../src/server/domain/types.js';
import { NewProfilePage, ProfilesPage } from '../../src/ui/pages/ProfilesPage.js';
import * as client from '../../src/ui/api/client.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  getCvAnalysis: vi.fn(),
  discardCvAnalysis: vi.fn(),
}));

function profile(id: string, name: string, counts = { jobs: 0, applications: 0, runs: 0 }): ProfileListItem {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/ /g, '-'),
    target_roles: ['Engineer'],
    locations: [],
    remote: 'any',
    seniority: '',
    keywords: [],
    excluded_companies: [],
    notes: '',
    cv: null,
    created_at: '2026-11-01T00:00:00.000Z',
    counts,
    cv_analysis_status: null,
  };
}

const ALPHA = profile('pa', 'Alpha roles', { jobs: 12, applications: 1, runs: 7 });

const READY: CvAnalysis = {
  id: 'cva1',
  profile_id: null,
  status: 'succeeded',
  file_name: 'Alex CV.pdf',
  file_type: 'pdf',
  started_at: '2026-11-07T10:00:00.000Z',
  finished_at: '2026-11-07T10:00:20.000Z',
  draft: {
    name: 'Backend roles',
    target_roles: ['Backend Engineer'],
    locations: ['Lisbon'],
    remote: 'remote',
    seniority: 'Senior',
    keywords: ['TypeScript'],
    notes: 'Eight years of backend work.',
  },
  error: null,
  created_at: '2026-11-07T10:00:00.000Z',
};
const BETA = profile('pb', 'Beta roles');

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<ProfilesPage />} />
        <Route path="/profiles/new" element={<NewProfilePage />} />
        <Route path="/profiles/data-roles" element={<p>profile dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Open the form' }));
  await user.type(await screen.findByLabelText('Name'), 'Data roles');
  await user.type(screen.getByLabelText('Target roles'), 'Data Engineer{Enter}');
  await user.click(screen.getByRole('button', { name: 'Create profile' }));
}

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.listProfiles).mockResolvedValue([ALPHA, BETA]);
  vi.mocked(client.getCvAnalysis).mockResolvedValue(null);
  vi.mocked(client.createProfile).mockResolvedValue({ ...BETA, id: 'pc', name: 'Data roles', slug: 'data-roles' } as Profile);
});

describe('ProfilesPage', () => {
  it('lists every profile with what it holds and links to open, edit and create', async () => {
    renderAt('/');
    const list = await screen.findByRole('list', { name: 'Profiles' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Alpha roles' })).toBeInTheDocument();
    expect(screen.getByText('12 jobs, 1 application and 7 runs')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Alpha roles' })).toHaveAttribute('href', '/profiles/alpha-roles');
    expect(screen.getByRole('link', { name: 'Edit Beta roles' })).toHaveAttribute('href', '/profiles/beta-roles/profile');
    expect(screen.getByRole('link', { name: 'New profile' })).toHaveAttribute('href', '/profiles/new');
  });

  it('shows the profile form when there is no profile, and opens the created profile', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listProfiles).mockResolvedValue([]);
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Create your first profile' })).toBeInTheDocument();
    await fillAndCreate(user);
    expect(client.createProfile).toHaveBeenCalledWith({
      name: 'Data roles',
      target_roles: ['Data Engineer'],
      locations: [],
      remote: 'any',
      seniority: '',
      keywords: [],
      excluded_companies: [],
      notes: '',
    });
    expect(await screen.findByText('profile dashboard')).toBeInTheDocument();
  });

  it('keeps the form and shows the server error when creating fails', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listProfiles).mockResolvedValue([]);
    vi.mocked(client.createProfile).mockRejectedValue(
      new client.ApiError(409, 'A profile named "Data roles" already exists'),
    );
    renderAt('/');
    await fillAndCreate(user);
    expect(await screen.findByText('A profile named "Data roles" already exists')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Data roles');
  });

  it('deletes a profile only after confirmation, naming what goes with it, and reloads the list', async () => {
    const user = userEvent.setup();
    vi.mocked(client.deleteProfile).mockResolvedValue(undefined);
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Delete Alpha roles' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Alpha roles?' });
    expect(dialog).toHaveTextContent(
      'This deletes the profile and its 12 jobs, 1 application and 7 runs, with their proposals, status history and run logs. It cannot be undone.',
    );
    expect(client.deleteProfile).not.toHaveBeenCalled();
    vi.mocked(client.listProfiles).mockResolvedValue([BETA]);
    await user.click(within(dialog).getByRole('button', { name: 'Delete profile' }));
    expect(client.deleteProfile).toHaveBeenCalledWith('pa');
    expect(await screen.findByRole('link', { name: 'Open Beta roles' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Alpha roles' })).not.toBeInTheDocument();
  });

  it('names the CV in the delete confirmation of a profile that keeps one', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listProfiles).mockResolvedValue([
      { ...ALPHA, cv: { file_name: 'Alex CV.pdf', added_at: '2026-11-07T10:00:00.000Z' } },
    ]);
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Delete Alpha roles' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Alpha roles?' });
    expect(dialog).toHaveTextContent('This deletes the profile, its CV and its 12 jobs, 1 application and 7 runs,');
  });

  it("points at a profile's own CV analysis from its row, and names it in the delete confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(client.listProfiles).mockResolvedValue([{ ...ALPHA, cv_analysis_status: 'succeeded' }]);
    renderAt('/');
    const badge = await screen.findByRole('link', { name: 'CV changes to review' });
    expect(badge).toHaveAttribute('href', '/profiles/alpha-roles/profile');
    // The new-profile card above the list is only for an analysis without a profile.
    expect(client.getCvAnalysis).toHaveBeenCalledWith(undefined);
    await user.click(screen.getByRole('button', { name: 'Delete Alpha roles' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Alpha roles?' });
    expect(dialog).toHaveTextContent('This deletes the profile, its CV analysis and its 12 jobs');
  });

  it('shows a ready CV analysis above the list and opens its review', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Your CV is analysed' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Profiles' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review and create' }));
    expect(await screen.findByLabelText('Name')).toHaveValue('Backend roles');
    expect(screen.getByRole('heading', { name: 'New profile' })).toBeInTheDocument();
  });

  it('keeps the profile when the delete confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Delete Alpha roles' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Alpha roles?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(client.deleteProfile).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Alpha roles' })).toBeInTheDocument();
  });

  it('shows why a delete was refused and keeps the profile', async () => {
    const user = userEvent.setup();
    vi.mocked(client.deleteProfile).mockRejectedValue(
      new client.ApiError(409, 'This profile has a queued or running run; cancel it first'),
    );
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Delete Alpha roles' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Alpha roles?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete profile' }));
    expect(await screen.findByText('This profile has a queued or running run; cancel it first')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alpha roles' })).toBeInTheDocument();
    expect(client.listProfiles).toHaveBeenCalledTimes(1);
  });

  it('shows the error when the list cannot be loaded', async () => {
    vi.mocked(client.listProfiles).mockRejectedValue(new Error('offline'));
    renderAt('/');
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });
});

describe('NewProfilePage', () => {
  it('creates a profile and opens it', async () => {
    const user = userEvent.setup();
    renderAt('/profiles/new');
    expect(screen.getByRole('heading', { name: 'New profile' })).toBeInTheDocument();
    await fillAndCreate(user);
    expect(client.createProfile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('profile dashboard')).toBeInTheDocument();
  });
});
