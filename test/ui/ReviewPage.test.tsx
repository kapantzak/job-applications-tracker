import { cleanup, render, screen } from '@testing-library/react';
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
}));

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
});

describe('ReviewPage', () => {
  it('shows the proposal details and the Gmail link', async () => {
    renderPage();
    expect(await screen.findByText(/Acme/)).toBeInTheDocument();
    expect(screen.getByText(/applied → interview/)).toBeInTheDocument();
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
