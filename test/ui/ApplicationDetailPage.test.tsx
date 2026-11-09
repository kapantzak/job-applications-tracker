import { cleanup, render, screen } from '@testing-library/react';
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
