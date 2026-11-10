import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationDetailPage } from '../../src/ui/pages/ApplicationDetailPage.js';
import * as client from '../../src/ui/api/client.js';
import { InProfile } from './profile-shell.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  getApplication: vi.fn(),
  patchApplication: vi.fn(),
}));

const detail: client.ApplicationDetail = {
  id: 'a1',
  profile_id: 'pf1',
  job_id: null,
  company: 'Acme',
  role: 'Platform Engineer',
  url: 'https://jobs.example.com/acme/1',
  status: 'applied',
  applied_at: '2026-03-04T00:00:00.000Z',
  status_changed_at: '2026-03-04T00:00:00.000Z',
  notes: null,
  sender_domains: ['example.com'],
  created_at: '2026-03-04T00:00:00.000Z',
  history: [],
};

function renderPage() {
  return render(
    <InProfile>
      <MemoryRouter initialEntries={['/profiles/platform-roles/applications/a1']}>
        <Routes>
          <Route path="/profiles/:profileSlug/applications/:id" element={<ApplicationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </InProfile>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.getApplication).mockResolvedValue(detail);
});

afterEach(cleanup);

describe('ApplicationDetailPage', () => {
  it('describes each status change in words, saying who made it', async () => {
    vi.mocked(client.getApplication).mockResolvedValue({
      ...detail,
      status: 'interview',
      history: [
        { id: 'h1', application_id: 'a1', from_status: null, to_status: 'applied', changed_at: '2026-03-04T10:00:00', source: 'user', proposal_id: null, created_at: 't' },
        { id: 'h2', application_id: 'a1', from_status: 'applied', to_status: 'no_response', changed_at: '2026-03-20T10:00:00', source: 'proposal', proposal_id: 'p1', created_at: 't' },
        { id: 'h3', application_id: 'a1', from_status: 'no_response', to_status: 'interview', changed_at: '2026-03-25T10:00:00', source: 'user', proposal_id: null, created_at: 't' },
      ],
    } as client.ApplicationDetail);
    renderPage();
    const history = (await screen.findByText('Added as Applied')).closest('ol')!;
    const entries = within(history).getAllByRole('listitem');
    expect(entries.map((li) => li.querySelector('p')!.textContent)).toEqual([
      'Added as Applied',
      'Applied → No response',
      'No response → Interview',
    ]);
    expect(entries.map((li) => li.querySelectorAll('p')[1]!.textContent!.split(',')[0])).toEqual([
      'Changed by you',
      'Accepted from a Gmail sync proposal',
      'Changed by you',
    ]);
    expect(screen.queryByText(/no_response|^(user|proposal),/)).not.toBeInTheDocument();
  });

  it('says what the page is for and explains each detail', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('The details sync uses to find replies, and every status change so far.')).toBeInTheDocument();
    expect(client.getApplication).toHaveBeenCalledWith('pf1', 'a1');
    for (const topic of ['Company', 'Role', 'URL', 'Applied date', 'Notes', 'Sender domains']) {
      expect(screen.getByRole('button', { name: `About ${topic}` })).toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveValue('Acme');
    await user.click(screen.getByRole('button', { name: 'About Notes' }));
    expect(await screen.findByRole('dialog', { name: 'About Notes' })).toHaveTextContent(
      'They are never sent to your agent.',
    );
  });
});
