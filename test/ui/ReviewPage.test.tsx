import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewPage } from '../../src/ui/pages/ReviewPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listProposals: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  listApplicationProposals: vi.fn(),
  acceptApplicationProposal: vi.fn(),
  rejectApplicationProposal: vi.fn(),
  acceptAllApplicationProposals: vi.fn(),
}));

const newApp = (id: string, company: string) => ({
  id,
  profile_id: 'pf1',
  run_id: 'r1',
  company,
  role: 'Platform Engineer',
  status: 'interview',
  applied_at: new Date(2026, 1, 1).toISOString(),
  job_id: null,
  url: null,
  sender_domains: [],
  confidence: 0.8,
  reason: 'Interview invitation for an application not tracked yet',
  evidence: { message_id: `m-${id}`, date: '2026-02-09', from: 'no-reply@ats.example.com', subject: 'Next steps', snippet: 'Pick a slot' },
  state: 'pending',
  application_id: null,
  decided_at: null,
  created_at: '2026-02-09T00:00:00Z',
});

const proposal = {
  id: 'p1',
  run_id: 'r1',
  application_id: 'a1',
  proposed_status: 'interview',
  confidence: 0.85,
  reason: 'Invitation received',
  evidence: {
    message_id: 'm1',
    date: '2026-01-02',
    from: 'hr@acme.com',
    subject: 'Interview',
    snippet: 'Join us',
  },
  state: 'pending',
  decided_at: null,
  created_at: '2026-01-02T00:00:00Z',
  application: { id: 'a1', company: 'Acme', role: 'Dev', status: 'applied' },
};

function renderPage() {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={['/profiles/platform-roles/review']}>
        <Routes>
          <Route path="/profiles/:profileSlug/review" element={<ReviewPage />} />
        </Routes>
      </MemoryRouter>
    </InProfile>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.listProposals).mockResolvedValue([proposal] as never);
  vi.mocked(client.listApplicationProposals).mockResolvedValue([]);
});

describe('ReviewPage', () => {
  it('shows the proposal details and the Gmail link', async () => {
    renderPage();
    expect(await screen.findByText(/Acme/)).toBeInTheDocument();
    expect(screen.getByText('Applied → Interview (85%)')).toBeInTheDocument();
    expect(screen.getByText(/85%/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /gmail/i });
    expect(link).toHaveAttribute('href', 'https://mail.google.com/mail/#all/m1');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('accepts a proposal and removes the card', async () => {
    const user = userEvent.setup();
    vi.mocked(client.acceptProposal).mockResolvedValue({} as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(client.acceptProposal).toHaveBeenCalledWith('pf1', 'p1');
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
    expect(screen.queryByText(/Acme/)).not.toBeInTheDocument();
  });

  it('rejects a proposal and removes the card', async () => {
    const user = userEvent.setup();
    vi.mocked(client.rejectProposal).mockResolvedValue({} as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(client.rejectProposal).toHaveBeenCalledWith('pf1', 'p1');
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    vi.mocked(client.listProposals).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
    expect(screen.getByText('Sync from Gmail to find your applications and the replies to them.')).toBeInTheDocument();
  });

  it('shows new applications above status changes, with their details and Gmail link', async () => {
    vi.mocked(client.listApplicationProposals).mockResolvedValue([newApp('n1', 'Initech')] as never);
    renderPage();
    const section = await screen.findByRole('region', { name: 'New applications' });
    expect(within(section).getByRole('heading', { name: 'Initech - Platform Engineer' })).toBeInTheDocument();
    expect(
      within(section).getByText(`New application · Interview · applied ${new Date(2026, 1, 1).toLocaleDateString()} (80%)`),
    ).toBeInTheDocument();
    expect(within(section).getByText('Next steps')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /gmail/i })).toHaveAttribute('href', 'https://mail.google.com/mail/#all/m-n1');
    expect(screen.getByRole('region', { name: 'Status changes' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['New applications', 'Status changes']);
  });

  it('accepts and rejects a new application and removes its card', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listProposals).mockResolvedValue([]);
    vi.mocked(client.listApplicationProposals).mockResolvedValue([newApp('n1', 'Initech'), newApp('n2', 'Hooli')] as never);
    vi.mocked(client.acceptApplicationProposal).mockResolvedValue({} as never);
    vi.mocked(client.rejectApplicationProposal).mockResolvedValue({} as never);
    renderPage();
    const first = await screen.findByRole('article', { name: 'Initech - Platform Engineer' });
    await user.click(within(first).getByRole('button', { name: 'Accept' }));
    expect(client.acceptApplicationProposal).toHaveBeenCalledWith('pf1', 'n1');
    const second = await screen.findByRole('article', { name: 'Hooli - Platform Engineer' });
    expect(screen.queryByText(/Initech/)).not.toBeInTheDocument();
    await user.click(within(second).getByRole('button', { name: 'Reject' }));
    expect(client.rejectApplicationProposal).toHaveBeenCalledWith('pf1', 'n2');
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
  });

  it('accepts all new applications only after confirming', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listApplicationProposals).mockResolvedValue([newApp('n1', 'Initech'), newApp('n2', 'Hooli')] as never);
    vi.mocked(client.acceptAllApplicationProposals).mockResolvedValue({ accepted: 2, created: 1, moved: 0, already_tracked: 1 });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept all new applications' }));
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Accept all new applications?' }));
    expect(dialog.getByText('2 applications will be added with the details shown. You can edit each one afterwards.')).toBeInTheDocument();
    expect(client.acceptAllApplicationProposals).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: 'Accept all' }));
    expect(client.acceptAllApplicationProposals).toHaveBeenCalledWith('pf1', ['n1', 'n2']);
    expect(await screen.findByRole('status')).toHaveTextContent('1 added, 1 already tracked.');
    await screen.findByRole('region', { name: 'Status changes' });
    expect(screen.queryByRole('region', { name: 'New applications' })).not.toBeInTheDocument();
  });

  it.each([
    ['already_tracked', 'Initech - Platform Engineer is already in your applications; nothing was added.'],
    ['moved', 'Initech - Platform Engineer was saved; it is now Interview.'],
  ])('says what happened when accepting found the application tracked (%s)', async (outcome, text) => {
    const user = userEvent.setup();
    vi.mocked(client.listApplicationProposals).mockResolvedValue([newApp('n1', 'Initech')] as never);
    vi.mocked(client.acceptApplicationProposal).mockResolvedValue({
      outcome,
      application: { company: 'Initech', role: 'Platform Engineer', status: 'interview' },
    } as never);
    renderPage();
    await user.click(within(await screen.findByRole('article', { name: 'Initech - Platform Engineer' })).getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('status')).toHaveTextContent(text);
  });

  it('reloads the status changes after an accept moved a saved application on (decision 19A)', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listApplicationProposals).mockResolvedValue([newApp('n1', 'Initech')] as never);
    vi.mocked(client.listProposals).mockResolvedValueOnce([proposal] as never).mockResolvedValueOnce([]);
    vi.mocked(client.acceptApplicationProposal).mockResolvedValue({
      outcome: 'moved',
      application: { company: 'Initech', role: 'Platform Engineer', status: 'interview' },
    } as never);
    renderPage();
    await screen.findByRole('region', { name: 'Status changes' });
    await user.click(within(await screen.findByRole('article', { name: 'Initech - Platform Engineer' })).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Status changes' })).not.toBeInTheDocument());
    expect(client.listProposals).toHaveBeenCalledTimes(2);
  });

  it('keeps every new application when Accept all is cancelled', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listApplicationProposals).mockResolvedValue([newApp('n1', 'Initech'), newApp('n2', 'Hooli')] as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept all new applications' }));
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Accept all new applications?' }));
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(client.acceptAllApplicationProposals).not.toHaveBeenCalled();
    expect(screen.getAllByRole('article', { name: /Platform Engineer/ })).toHaveLength(2);
  });

  it('offers Accept all only for two or more new applications', async () => {
    vi.mocked(client.listApplicationProposals).mockResolvedValue([newApp('n1', 'Initech')] as never);
    renderPage();
    await screen.findByRole('region', { name: 'New applications' });
    expect(screen.queryByRole('button', { name: 'Accept all new applications' })).not.toBeInTheDocument();
  });

  it('keeps the card and shows an error when accept fails', async () => {
    const user = userEvent.setup();
    vi.mocked(client.acceptProposal).mockRejectedValue(new Error('boom'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByText(/Acme/)).toBeInTheDocument();
  });
});
