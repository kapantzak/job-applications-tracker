import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CvAnalysis, Profile } from '../../src/server/domain/types.js';
import { ProfilePage } from '../../src/ui/pages/ProfilePage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile, TEST_PROFILE } from './profile-shell.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  updateProfile: vi.fn(),
  removeProfileCv: vi.fn(),
  getCvAnalysis: vi.fn(),
  uploadCv: vi.fn(),
  discardCvAnalysis: vi.fn(),
}));

const profileChanged = vi.fn();

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function page(profile: Profile) {
  return (
    <InProfile profile={profile} profileChanged={profileChanged}>
      <MemoryRouter initialEntries={['/profiles/platform-roles/profile']}>
        <Routes>
          <Route path="/profiles/:profileSlug/profile" element={<ProfilePage />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </InProfile>
  );
}

function renderPage(profile = TEST_PROFILE) {
  return render(page(profile));
}

// Vitest globals are off, so Testing Library does not auto-clean.
afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.getCvAnalysis).mockResolvedValue(null);
});

describe('ProfilePage', () => {
  it('saves the edited fields for the current profile and tells the shell', async () => {
    const user = userEvent.setup();
    vi.mocked(client.updateProfile).mockResolvedValue({ ...TEST_PROFILE, target_roles: ['Engineer', 'Lead'] });
    renderPage();
    expect(screen.getByLabelText('Name')).toHaveValue('Platform roles');
    await user.type(screen.getByLabelText('Target roles'), 'Lead,');
    await user.type(screen.getByLabelText('Locations'), 'Berlin{Enter}');
    await user.selectOptions(screen.getByLabelText('Remote'), 'hybrid');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(client.updateProfile).toHaveBeenCalledWith(
      'pf1',
      {
        name: 'Platform roles',
        target_roles: ['Engineer', 'Lead'],
        locations: ['Berlin'],
        remote: 'hybrid',
        seniority: '',
        keywords: [],
        excluded_companies: [],
        notes: '',
      },
      undefined,
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(profileChanged).toHaveBeenCalledWith(expect.objectContaining({ target_roles: ['Engineer', 'Lead'] }));
    expect(screen.getByTestId('where')).toHaveTextContent('/profiles/platform-roles/profile');
  });

  it('moves to the new slug after a rename', async () => {
    const user = userEvent.setup();
    const renamed = { ...TEST_PROFILE, name: 'Lead roles', slug: 'lead-roles' };
    vi.mocked(client.updateProfile).mockResolvedValue(renamed);
    renderPage();
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, '  Lead roles ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.updateProfile).toHaveBeenCalledWith(
      'pf1',
      expect.objectContaining({ name: 'Lead roles' }),
      undefined,
    );
    expect(await screen.findByTestId('where')).toHaveTextContent('/profiles/lead-roles/profile');
    expect(profileChanged).toHaveBeenCalledWith(renamed);
  });

  it('shows the name rule under the input, turns it into an error while invalid, and does not save', async () => {
    const user = userEvent.setup();
    renderPage();
    const name = screen.getByLabelText('Name');
    expect(name).toHaveAccessibleDescription('Letters, numbers and spaces only.');
    await user.type(name, '/Ops');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Use only letters, numbers and single spaces.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.updateProfile).not.toHaveBeenCalled();
    await user.clear(name);
    await user.type(name, 'Μηχανικός 2');
    expect(name).not.toHaveAttribute('aria-invalid');
    expect(name).toHaveAccessibleDescription('Letters, numbers and spaces only.');
  });

  it('requires a name and a target role without calling the API', async () => {
    const user = userEvent.setup();
    renderPage({ ...TEST_PROFILE, name: '', target_roles: [] });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Give the profile a name')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Data roles');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Add at least one target role')).toBeInTheDocument();
    expect(client.updateProfile).not.toHaveBeenCalled();
  });

  it('renders the server error message on ApiError and does not report a change', async () => {
    const user = userEvent.setup();
    vi.mocked(client.updateProfile).mockRejectedValue(
      new client.ApiError(409, 'A profile named "Data roles" already exists'),
    );
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A profile named "Data roles" already exists')).toBeInTheDocument();
    expect(profileChanged).not.toHaveBeenCalled();
  });
});

describe('ProfilePage: the kept CV', () => {
  const WITH_CV = { ...TEST_PROFILE, cv: { file_name: 'Alex CV.pdf', added_at: '2026-11-07T10:00:00.000Z' } };

  it('says a profile without a CV has none and offers Add CV', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'CV' })).toBeInTheDocument();
    expect(screen.getByText(/No CV yet/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add CV' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
    expect(client.getCvAnalysis).toHaveBeenCalledWith('pf1');
  });

  it('shows the CV with a download link under its original name', () => {
    renderPage(WITH_CV);
    expect(screen.getByRole('heading', { name: 'CV' })).toBeInTheDocument();
    expect(screen.getByText('Alex CV.pdf')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Download' });
    expect(link).toHaveAttribute('href', '/api/profiles/pf1/cv');
    expect(link).toHaveAttribute('download', 'Alex CV.pdf');
  });

  it('removes the CV only after confirmation and tells the shell', async () => {
    const user = userEvent.setup();
    vi.mocked(client.removeProfileCv).mockResolvedValue({ ...WITH_CV, cv: null });
    renderPage(WITH_CV);
    await user.click(screen.getByRole('button', { name: 'Remove CV' }));
    let dialog = await screen.findByRole('alertdialog', { name: 'Remove the CV?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep the CV' }));
    expect(client.removeProfileCv).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove CV' }));
    dialog = await screen.findByRole('alertdialog', { name: 'Remove the CV?' });
    expect(dialog).toHaveTextContent('The file and the text read from it are deleted.');
    await user.click(within(dialog).getByRole('button', { name: 'Remove CV' }));
    expect(client.removeProfileCv).toHaveBeenCalledWith('pf1');
    expect(profileChanged).toHaveBeenCalledWith({ ...WITH_CV, cv: null });
  });

  it('keeps the edited fields out of the CV: Save sends no cv field', async () => {
    const user = userEvent.setup();
    vi.mocked(client.updateProfile).mockResolvedValue(WITH_CV);
    renderPage(WITH_CV);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(vi.mocked(client.updateProfile).mock.calls[0]![1]).not.toHaveProperty('cv');
  });
});

// SOW-0024: Replace CV and Add CV with the review panel.
describe('ProfilePage: Replace CV and Add CV', () => {
  const WITH_CV: Profile = {
    ...TEST_PROFILE,
    target_roles: ['Platform Engineer'],
    locations: ['Lisbon'],
    remote: 'remote',
    seniority: 'Senior',
    keywords: ['Kubernetes'],
    cv: { file_name: 'Old CV.pdf', added_at: '2026-11-07T10:00:00.000Z' },
  };

  const READY: CvAnalysis = {
    id: 'cva-p',
    profile_id: 'pf1',
    status: 'succeeded',
    file_name: 'New CV.docx',
    file_type: 'docx',
    started_at: '2026-11-08T10:00:00.000Z',
    finished_at: '2026-11-08T10:00:09.000Z',
    draft: {
      name: 'Never used',
      target_roles: ['Platform Engineer'],
      locations: ['Porto'],
      remote: 'hybrid',
      seniority: 'Staff',
      keywords: ['kubernetes', 'Go'],
      notes: 'Never used.',
    },
    error: null,
    created_at: '2026-11-08T10:00:00.000Z',
  };

  async function openReview(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Review changes' }));
    return screen.findByRole('dialog', { name: 'Review the suggested changes' });
  }

  it('Replace CV opens the upload card for this profile and starts its analysis', async () => {
    const user = userEvent.setup();
    const running: CvAnalysis = { ...READY, status: 'running', finished_at: null, draft: null };
    vi.mocked(client.uploadCv).mockResolvedValue(running);
    renderPage(WITH_CV);
    await user.click(await screen.findByRole('button', { name: 'Replace CV' }));
    expect(screen.getByRole('heading', { name: 'Replace your CV' })).toBeInTheDocument();
    const file = new File(['x'], 'New CV.docx');
    await user.upload(screen.getByLabelText('CV file'), file);
    await user.click(screen.getByRole('button', { name: 'Analyse CV' }));
    expect(client.uploadCv).toHaveBeenCalledWith(file, 'pf1');
    expect(await screen.findByText(/The suggested changes will be ready soon/)).toBeInTheDocument();
    // One analysis per profile: no second upload while it exists.
    expect(screen.queryByRole('button', { name: 'Replace CV' })).not.toBeInTheDocument();
  });

  it('Cancel closes the upload card without uploading', async () => {
    const user = userEvent.setup();
    renderPage(WITH_CV);
    await user.click(await screen.findByRole('button', { name: 'Replace CV' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Replace your CV' })).not.toBeInTheDocument();
    expect(client.uploadCv).not.toHaveBeenCalled();
  });

  it('lists only the differing fields with Keep current pre-selected, compared with the unsaved form', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    renderPage(WITH_CV);
    // An unsaved edit makes Locations match the suggestion, so it is not listed.
    await user.click(screen.getByRole('button', { name: 'Remove Lisbon' }));
    await user.type(screen.getByLabelText('Locations'), 'Porto{Enter}');
    const panel = await openReview(user);

    expect(
      within(panel)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Remote', 'Seniority', 'Keywords']);
    for (const name of ['Remote', 'Seniority', 'Keywords']) {
      expect(
        within(within(panel).getByRole('radiogroup', { name })).getByRole('radio', { name: 'Keep current' }),
      ).toBeChecked();
    }
    expect(
      within(within(panel).getByRole('radiogroup', { name: 'Keywords' }))
        .getAllByRole('radio')
        .map((r) => r.getAttribute('value')),
    ).toEqual(['keep', 'use', 'add']);
    expect(within(panel).queryByText('Never used')).not.toBeInTheDocument();
  });

  it('Apply writes the choices into the form and Save sends them with the analysis', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    const saved: Profile = {
      ...WITH_CV,
      remote: 'hybrid',
      keywords: ['Kubernetes', 'Go'],
      cv: { file_name: 'New CV.docx', added_at: 't' },
    };
    vi.mocked(client.updateProfile).mockResolvedValue(saved);
    renderPage(WITH_CV);
    await user.type(screen.getByLabelText('Notes'), 'Unsaved note');
    const panel = await openReview(user);
    const group = (name: string) => within(panel).getByRole('radiogroup', { name });
    await user.click(within(group('Remote')).getByRole('radio', { name: 'Use suggested' }));
    await user.click(within(group('Keywords')).getByRole('radio', { name: 'Add the new items' }));
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Remote')).toHaveValue('hybrid');
    expect(screen.getByRole('button', { name: 'Remove Go' })).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue('Unsaved note');
    expect(screen.getByText(/Save to keep them and replace your CV with this file/)).toBeInTheDocument();
    expect(client.updateProfile).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.updateProfile).toHaveBeenCalledWith(
      'pf1',
      {
        name: 'Platform roles',
        target_roles: ['Platform Engineer'],
        locations: ['Lisbon'],
        remote: 'hybrid',
        seniority: 'Senior',
        keywords: ['Kubernetes', 'Go'],
        excluded_companies: [],
        notes: 'Unsaved note',
      },
      'cva-p',
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(profileChanged).toHaveBeenCalledWith(saved);
    // The analysis ended with the Save; the note goes and Replace CV comes back.
    expect(screen.queryByText(/Save to keep them/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review changes' })).not.toBeInTheDocument();
  });

  it('Apply updates the seniority chips', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    renderPage(WITH_CV);
    const panel = await openReview(user);
    await user.click(
      within(within(panel).getByRole('radiogroup', { name: 'Seniority' })).getByRole('radio', {
        name: 'Use suggested',
      }),
    );
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Staff', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Senior', pressed: false })).toBeInTheDocument();
  });

  it('Cancel in the panel changes nothing and keeps the analysis for later', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    vi.mocked(client.updateProfile).mockResolvedValue(WITH_CV);
    renderPage(WITH_CV);
    const panel = await openReview(user);
    await user.click(
      within(within(panel).getByRole('radiogroup', { name: 'Remote' })).getByRole('radio', { name: 'Use suggested' }),
    );
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Remote')).toHaveValue('remote');
    expect(screen.getByRole('button', { name: 'Review changes' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(vi.mocked(client.updateProfile).mock.calls[0]![2]).toBeUndefined();
  });

  it("Discard deletes this profile's analysis only after confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    vi.mocked(client.discardCvAnalysis).mockResolvedValue(undefined);
    renderPage(WITH_CV);
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard the CV analysis?' });
    expect(dialog).toHaveTextContent('Your profile and its current CV stay as they are.');
    expect(client.discardCvAnalysis).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(client.discardCvAnalysis).toHaveBeenCalledWith('pf1');
    expect(await screen.findByRole('button', { name: 'Replace CV' })).toBeInTheDocument();
  });

  it('another profile starts with its own form and no applied analysis', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockImplementation(async (id) => (id === 'pf1' ? READY : null));
    const view = renderPage(WITH_CV);
    const panel = await openReview(user);
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));
    expect(screen.getByText(/Save to keep them/)).toBeInTheDocument();

    view.rerender(page({ ...WITH_CV, id: 'pf2', slug: 'data-roles', name: 'Data roles' }));
    expect(await screen.findByRole('button', { name: 'Replace CV' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Data roles');
    expect(screen.queryByText(/Save to keep them|was discarded/)).not.toBeInTheDocument();
    expect(client.getCvAnalysis).toHaveBeenLastCalledWith('pf2');
  });

  it('Add CV lists only the empty fields, with Use suggested pre-selected', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    renderPage({ ...TEST_PROFILE, target_roles: ['Engineer'], seniority: 'Senior' });
    const panel = await openReview(user);
    expect(
      within(panel)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Locations', 'Remote', 'Keywords']);
    expect(
      within(within(panel).getByRole('radiogroup', { name: 'Locations' })).getByRole('radio', {
        name: 'Use suggested',
      }),
    ).toBeChecked();
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Remove Porto' })).toBeInTheDocument();
    expect(screen.getByText(/Save to keep them and add this CV to the profile/)).toBeInTheDocument();
  });

  it('says so when the profile already matches the CV, and still lets Apply keep the new CV', async () => {
    const user = userEvent.setup();
    const draft = READY.draft!;
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    vi.mocked(client.updateProfile).mockResolvedValue(WITH_CV);
    renderPage({
      ...WITH_CV,
      locations: draft.locations,
      remote: draft.remote,
      seniority: draft.seniority,
      keywords: draft.keywords,
    });
    const panel = await openReview(user);
    expect(within(panel).getByText('Your profile already matches this CV.')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(vi.mocked(client.updateProfile).mock.calls[0]![2]).toBe('cva-p');
  });

  it('a Save refused because the analysis is gone re-reads it and drops it from the next Save', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    vi.mocked(client.updateProfile).mockRejectedValueOnce(
      new client.ApiError(409, 'This CV analysis no longer exists.'),
    );
    renderPage(WITH_CV);
    const panel = await openReview(user);
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));
    vi.mocked(client.getCvAnalysis).mockResolvedValue(null);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This CV analysis no longer exists.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Replace CV' })).toBeInTheDocument();
    expect(screen.queryByText(/Save to keep them/)).not.toBeInTheDocument();
    expect(screen.getByText(/The CV analysis of New CV.docx was discarded/)).toBeInTheDocument();
    vi.mocked(client.updateProfile).mockResolvedValue(WITH_CV);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(vi.mocked(client.updateProfile).mock.calls[1]![2]).toBeUndefined();
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.queryByText(/was discarded/)).not.toBeInTheDocument();
  });

  it('Discard after Apply keeps the applied values in the form and warns that Save keeps them without the CV', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    vi.mocked(client.discardCvAnalysis).mockResolvedValue(undefined);
    renderPage(WITH_CV);
    const panel = await openReview(user);
    await user.click(within(within(panel).getByRole('radiogroup', { name: 'Remote' })).getByRole('radio', { name: 'Use suggested' }));
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));

    expect(
      await screen.findByText(
        'The CV analysis of New CV.docx was discarded. The values you applied from it are still in the form: Save keeps them without the new CV, or reload the page to drop them.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Remote')).toHaveValue('hybrid');
    expect(screen.queryByText(/Save to keep them and replace/)).not.toBeInTheDocument();
  });
});
