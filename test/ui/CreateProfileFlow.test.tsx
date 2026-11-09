import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CvAnalysis, Profile } from '../../src/server/domain/types.js';
import * as client from '../../src/ui/api/client.js';
import { CreateProfileFlow } from '../../src/ui/components/CreateProfileFlow.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  createProfile: vi.fn(),
  getCvAnalysis: vi.fn(),
  uploadCv: vi.fn(),
  retryCvAnalysis: vi.fn(),
  discardCvAnalysis: vi.fn(),
}));

const RUNNING: CvAnalysis = {
  id: 'cva1',
  profile_id: null,
  status: 'running',
  file_name: 'Alex CV.pdf',
  file_type: 'pdf',
  started_at: new Date().toISOString(),
  finished_at: null,
  draft: null,
  error: null,
  created_at: new Date().toISOString(),
};

const READY: CvAnalysis = {
  ...RUNNING,
  status: 'succeeded',
  finished_at: new Date().toISOString(),
  draft: {
    name: 'Backend roles',
    target_roles: ['Backend Engineer', 'Platform Engineer'],
    locations: ['Lisbon'],
    remote: 'remote',
    seniority: 'Senior, Staff',
    keywords: ['TypeScript'],
    notes: 'Eight years of backend work at Acme.',
  },
};

const pdf = (name = 'Alex CV.pdf', size = 2048) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });

function renderFlow(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/profiles/new', state }]}>
      <Routes>
        <Route path="/profiles/new" element={<CreateProfileFlow />} />
        <Route path="/profiles/backend-roles" element={<p>profile dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.getCvAnalysis).mockResolvedValue(null);
});

describe('CreateProfileFlow: choosing', () => {
  it('offers the CV as the recommended choice and the form by hand', async () => {
    renderFlow();
    expect(await screen.findByRole('heading', { name: 'Start from your CV' })).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('PDF, Word (.docx), .txt or .md, up to 10 MB')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fill in by hand' })).toBeInTheDocument();
    // The analysis starts only from its button, which appears once a file is chosen.
    expect(screen.queryByRole('button', { name: 'Analyse CV' })).not.toBeInTheDocument();
  });

  it('opens the empty form by hand and goes back', async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(await screen.findByRole('button', { name: 'Open the form' }));
    expect(screen.getByText(/Name and at least one target role are required/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Start from your CV' })).toBeInTheDocument();
  });
});

describe('CreateProfileFlow: uploading', () => {
  it('shows the chosen file, then starts the analysis and shows its progress', async () => {
    const user = userEvent.setup();
    vi.mocked(client.uploadCv).mockResolvedValue(RUNNING);
    renderFlow();
    const file = pdf();
    await user.upload(await screen.findByLabelText('CV file'), file);
    expect(screen.getByText('Alex CV.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(client.uploadCv).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Analyse CV' }));
    // No profile: the analysis becomes a new profile.
    expect(client.uploadCv).toHaveBeenCalledWith(file, undefined);
    expect(await screen.findByRole('heading', { name: 'Analysing your CV' })).toBeInTheDocument();
    expect(screen.getByText('We are analysing your CV with AI. Your profile will be ready soon.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Analysing your CV' })).toBeInTheDocument();
    expect(screen.getByText('You can leave this page; the analysis keeps going.')).toBeInTheDocument();
  });

  it('accepts a dropped file', async () => {
    renderFlow();
    const zone = await screen.findByTestId('cv-drop-zone');
    fireEvent.drop(zone, { dataTransfer: { files: [pdf('cv.docx')] } });
    expect(screen.getByText('cv.docx')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyse CV' })).toBeInTheDocument();
  });

  it('refuses a file over 10 MB without uploading it', async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.upload(await screen.findByLabelText('CV file'), pdf('big.pdf', 10 * 1024 * 1024 + 1));
    expect(screen.getByRole('alert')).toHaveTextContent('The file is larger than 10 MB');
    expect(screen.queryByRole('button', { name: 'Analyse CV' })).not.toBeInTheDocument();
  });

  it('shows why the server refused the file and keeps the upload card', async () => {
    const user = userEvent.setup();
    vi.mocked(client.uploadCv).mockRejectedValue(
      new client.ApiError(422, 'No readable text was found in this file. A scanned PDF has no text layer; fill in the form by hand instead.'),
    );
    renderFlow();
    await user.upload(await screen.findByLabelText('CV file'), pdf());
    await user.click(screen.getByRole('button', { name: 'Analyse CV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No readable text was found in this file.');
    expect(screen.getByRole('button', { name: 'Analyse CV' })).toBeEnabled();
  });
});

describe('CreateProfileFlow: an analysis in progress or done', () => {
  it('polls a running analysis and opens the review once it is ready', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValueOnce(RUNNING).mockResolvedValue(READY);
    renderFlow();
    expect(await screen.findByRole('heading', { name: 'Analysing your CV' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Your CV is analysed' }, { timeout: 3000 })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review and create' }));
    expect(screen.getByText(/Suggested by AI from Alex CV\.pdf/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Backend roles');
    expect(screen.getByText('Platform Engineer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Senior' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Staff' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Lead' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Notes')).toHaveValue('Eight years of backend work at Acme.');
  });

  it('creates the reviewed profile with the analysis and opens it', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    vi.mocked(client.createProfile).mockResolvedValue({ id: 'p9', slug: 'backend-roles' } as Profile);
    renderFlow({ review: true });
    await user.click(await screen.findByRole('button', { name: 'Lead' }));
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(client.createProfile).toHaveBeenCalledWith(
      {
        name: 'Backend roles',
        target_roles: ['Backend Engineer', 'Platform Engineer'],
        locations: ['Lisbon'],
        remote: 'remote',
        seniority: 'Senior, Staff, Lead',
        keywords: ['TypeScript'],
        excluded_companies: [],
        notes: 'Eight years of backend work at Acme.',
        mail_filter_kind: 'label',
        mail_filter: '',
      },
      'cva1',
    );
    expect(await screen.findByText('profile dashboard')).toBeInTheDocument();
  });

  it('cancels a running analysis only after confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(RUNNING);
    vi.mocked(client.discardCvAnalysis).mockResolvedValue(undefined);
    renderFlow();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    let dialog = await screen.findByRole('alertdialog', { name: 'Cancel the CV analysis?' });
    expect(dialog).toHaveTextContent('The agent is stopped and the uploaded CV is deleted.');
    await user.click(within(dialog).getByRole('button', { name: 'Keep analysing' }));
    expect(client.discardCvAnalysis).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    dialog = await screen.findByRole('alertdialog', { name: 'Cancel the CV analysis?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel analysis' }));
    expect(client.discardCvAnalysis).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Start from your CV' })).toBeInTheDocument();
  });

  it('discards a ready analysis only after confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    vi.mocked(client.discardCvAnalysis).mockResolvedValue(undefined);
    renderFlow();
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard the CV analysis?' });
    expect(client.discardCvAnalysis).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(client.discardCvAnalysis).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('CV file')).toBeInTheDocument();
  });

  it('shows a failed analysis with its reason and runs it again', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue({
      ...RUNNING,
      status: 'failed',
      error: 'The agent could not analyse the CV: Timed out after 300000 ms',
    });
    vi.mocked(client.retryCvAnalysis).mockResolvedValue(RUNNING);
    renderFlow();
    expect(await screen.findByRole('heading', { name: 'The CV analysis failed' })).toBeInTheDocument();
    expect(screen.getByText('The agent could not analyse the CV: Timed out after 300000 ms')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Analyse again' }));
    expect(client.retryCvAnalysis).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Analysing your CV' })).toBeInTheDocument();
  });

  it('shows an analysis the app stopped as interrupted', async () => {
    vi.mocked(client.getCvAnalysis).mockResolvedValue({
      ...RUNNING,
      status: 'interrupted',
      error: 'The app stopped while the CV was being analysed',
    });
    renderFlow();
    expect(await screen.findByRole('heading', { name: 'The CV analysis was interrupted' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyse again' })).toBeInTheDocument();
    expect(screen.queryByLabelText('CV file')).not.toBeInTheDocument();
  });
});

describe('CreateProfileFlow: state changed elsewhere', () => {
  it('shows the analysis another tab started when the upload is refused with 409', async () => {
    const user = userEvent.setup();
    vi.mocked(client.uploadCv).mockRejectedValue(
      new client.ApiError(409, 'A CV analysis already exists. Discard it before uploading another CV.'),
    );
    renderFlow();
    await user.upload(await screen.findByLabelText('CV file'), pdf());
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    await user.click(screen.getByRole('button', { name: 'Analyse CV' }));
    expect(await screen.findByRole('heading', { name: 'Your CV is analysed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('re-reads the analysis when Discard finds it already gone', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCvAnalysis).mockResolvedValue(READY);
    vi.mocked(client.discardCvAnalysis).mockRejectedValue(new client.ApiError(404, 'There is no CV analysis'));
    renderFlow();
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    vi.mocked(client.getCvAnalysis).mockResolvedValue(null);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    expect(await screen.findByLabelText('CV file')).toBeInTheDocument();
  });

  it('keeps a cancelled analysis gone when an older poll answers late', async () => {
    const user = userEvent.setup();
    let answerLate!: (a: CvAnalysis) => void;
    vi.mocked(client.getCvAnalysis)
      .mockResolvedValueOnce(RUNNING)
      .mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)));
    vi.mocked(client.discardCvAnalysis).mockResolvedValue(undefined);
    renderFlow();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    // The next poll starts while the dialog is open and is still pending when the cancel lands.
    await waitFor(() => expect(client.getCvAnalysis).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel the CV analysis?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel analysis' }));
    expect(await screen.findByLabelText('CV file')).toBeInTheDocument();
    await act(async () => answerLate(RUNNING));
    expect(screen.queryByRole('heading', { name: 'Analysing your CV' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('CV file')).toBeInTheDocument();
  });

  it('announces the analysis status to screen readers as it changes', async () => {
    vi.mocked(client.getCvAnalysis).mockResolvedValueOnce(RUNNING).mockResolvedValue(READY);
    renderFlow();
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Analysing your CV');
    await waitFor(() => expect(status).toHaveTextContent('Your CV is analysed'), { timeout: 3000 });
    // The same region, still mounted, so the change is read out.
    expect(screen.getByRole('status')).toBe(status);
  });
});
