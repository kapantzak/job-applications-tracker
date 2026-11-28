import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CvAnalysis, Profile, ProfileListItem } from '../../src/server/domain/types.js';
import { NewProfilePage, ProfilesPage } from '../../src/ui/pages/ProfilesPage.js';
import * as client from '../../src/ui/api/client.js';
import { DEFAULT_SETTINGS } from '../../src/server/db/settings-repo.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  getCvAnalysis: vi.fn(),
  discardCvAnalysis: vi.fn(),
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
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
    mail_filter_kind: 'label',
    mail_filter: '',
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
  vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
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
      mail_filter_kind: 'label',
      mail_filter: '',
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

describe('ProfilesPage default profile (SOW-0059)', () => {
  const card = async (name: string) => (await screen.findByRole('heading', { name })).closest('li') as HTMLElement;

  it('offers Set as default on every profile when none is stored, and shows no badge', async () => {
    renderAt('/');
    expect(within(await card('Alpha roles')).getByRole('button', { name: 'Set Alpha roles as default' })).toBeInTheDocument();
    expect(within(await card('Beta roles')).getByRole('button', { name: 'Set Beta roles as default' })).toBeInTheDocument();
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove .* as default$/ })).not.toBeInTheDocument();
  });

  it('marks the stored default and offers to remove it', async () => {
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, default_profile_id: 'pb' });
    renderAt('/');
    const beta = await card('Beta roles');
    expect(within(beta).getByText('Default')).toBeInTheDocument();
    expect(within(beta).getByRole('button', { name: 'Remove Beta roles as default' })).toBeInTheDocument();
    expect(within(beta).queryByRole('button', { name: 'Set Beta roles as default' })).not.toBeInTheDocument();
    const alpha = await card('Alpha roles');
    expect(within(alpha).queryByText('Default')).not.toBeInTheDocument();
    expect(within(alpha).getByRole('button', { name: 'Set Alpha roles as default' })).toBeInTheDocument();
  });

  it('sets a profile as default and moves the badge', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, default_profile_id: 'pb' });
    vi.mocked(client.patchSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, default_profile_id: 'pa' });
    renderAt('/');
    await user.click(within(await card('Alpha roles')).getByRole('button', { name: 'Set Alpha roles as default' }));
    expect(client.patchSettings).toHaveBeenCalledWith({ default_profile_id: 'pa' });
    expect(await within(await card('Alpha roles')).findByText('Default')).toBeInTheDocument();
    expect(within(await card('Beta roles')).queryByText('Default')).not.toBeInTheDocument();
  });

  it('removes the default', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, default_profile_id: 'pb' });
    vi.mocked(client.patchSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, default_profile_id: '' });
    renderAt('/');
    await user.click(within(await card('Beta roles')).getByRole('button', { name: 'Remove Beta roles as default' }));
    expect(client.patchSettings).toHaveBeenCalledWith({ default_profile_id: '' });
    expect(await within(await card('Beta roles')).findByRole('button', { name: 'Set Beta roles as default' })).toBeInTheDocument();
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
  });

  it('shows why setting the default failed and keeps the badge where it was', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, default_profile_id: 'pb' });
    vi.mocked(client.patchSettings).mockRejectedValue(new Error('default_profile_id: Profile not found'));
    renderAt('/');
    await user.click(within(await card('Alpha roles')).getByRole('button', { name: 'Set Alpha roles as default' }));
    expect(await screen.findByText('default_profile_id: Profile not found')).toBeInTheDocument();
    expect(within(await card('Beta roles')).getByText('Default')).toBeInTheDocument();
  });

  it('marks a lone profile as the default without offering to change it', async () => {
    vi.mocked(client.listProfiles).mockResolvedValue([ALPHA]);
    renderAt('/');
    const alpha = await card('Alpha roles');
    expect(within(alpha).getByText('Default')).toBeInTheDocument();
    expect(within(alpha).queryByRole('button', { name: /as default$/ })).not.toBeInTheDocument();
  });

  it('reloads the default after a delete, so the deleted default leaves a lone profile marked', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, default_profile_id: 'pb' });
    vi.mocked(client.deleteProfile).mockResolvedValue(undefined);
    renderAt('/');
    await user.click(within(await card('Beta roles')).getByRole('button', { name: 'Delete Beta roles' }));
    vi.mocked(client.listProfiles).mockResolvedValue([ALPHA]);
    vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, default_profile_id: '' });
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete profile' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Beta roles' })).not.toBeInTheDocument());
    expect(within(await card('Alpha roles')).getByText('Default')).toBeInTheDocument();
    expect(client.getSettings).toHaveBeenCalledTimes(2);
  });

  it('still lists the profiles when the settings cannot be loaded', async () => {
    vi.mocked(client.getSettings).mockRejectedValue(new Error('offline'));
    renderAt('/');
    expect(within(await card('Alpha roles')).getByRole('button', { name: 'Set Alpha roles as default' })).toBeInTheDocument();
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
  });

  it('clears a failed default change once the list reloads after a delete', async () => {
    const user = userEvent.setup();
    vi.mocked(client.patchSettings).mockRejectedValue(new Error('Server unavailable'));
    vi.mocked(client.deleteProfile).mockResolvedValue(undefined);
    renderAt('/');
    await user.click(within(await card('Alpha roles')).getByRole('button', { name: 'Set Alpha roles as default' }));
    expect(await screen.findByText('Server unavailable')).toBeInTheDocument();
    await user.click(within(await card('Beta roles')).getByRole('button', { name: 'Delete Beta roles' }));
    vi.mocked(client.listProfiles).mockResolvedValue([ALPHA]);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete profile' }));
    await waitFor(() => expect(screen.queryByText('Server unavailable')).not.toBeInTheDocument());
  });
});
