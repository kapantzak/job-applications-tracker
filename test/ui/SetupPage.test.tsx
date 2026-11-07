import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupPage } from '../../src/ui/pages/SetupPage.js';
import * as client from '../../src/ui/api/client.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  getAdapters: vi.fn(),
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
}));

const adapters = [
  { id: 'claude' as const, installed: true, version: '1.2.3', gmail_guide: false },
  { id: 'codex' as const, installed: false, message: 'codex not found', gmail_guide: true },
  { id: 'custom' as const, installed: true, gmail_guide: true },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <SetupPage />
    </MemoryRouter>,
  );
}

// Vitest globals are off, so Testing Library does not auto-clean.
afterEach(cleanup);

beforeEach(() => {
  vi.mocked(client.getAdapters).mockResolvedValue(adapters);
  vi.mocked(client.getSettings).mockResolvedValue({ adapter_id: 'claude', custom_command: '' } as never);
  vi.mocked(client.patchSettings).mockResolvedValue({} as never);
});

describe('SetupPage', () => {
  it('shows the Gmail access section only for adapters with a gmail guide', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('radio', { name: /claude/i });
    expect(screen.queryByText('Gmail access')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /codex/i }));
    expect(screen.getByText('Gmail access')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /gmail/i })).toHaveAttribute(
      'href',
      'https://www.npmjs.com/package/job-applications-tracker#gmail-access-for-other-agents',
    );
  });

  it('labels each adapter as signed in or not signed in and stays silent when unknown', async () => {
    vi.mocked(client.getAdapters).mockResolvedValue([
      { id: 'claude', installed: true, version: '1.2.3', authenticated: true, gmail_guide: false },
      { id: 'codex', installed: true, version: '0.1', authenticated: false, authMessage: 'Not logged in', gmail_guide: true },
      { id: 'custom', installed: true, gmail_guide: true },
    ]);
    renderPage();
    const claude = await screen.findByRole('radio', { name: /claude/i });
    expect(claude.closest('label')).toHaveTextContent('signed in');
    expect(claude.closest('label')).not.toHaveTextContent('not signed in');
    const codex = screen.getByRole('radio', { name: /codex/i }).closest('label');
    expect(codex).toHaveTextContent('not signed in (Not logged in)');
    expect(screen.getByRole('radio', { name: /custom/i }).closest('label')).not.toHaveTextContent('signed in');
  });

  it('saves the chosen adapter and custom command', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('radio', { name: /custom/i }));
    await user.type(screen.getByLabelText('Custom command'), 'my-agent');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.patchSettings).toHaveBeenCalledWith({ adapter_id: 'custom', custom_command: 'my-agent' });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('offers the custom adapter from a fresh server list and shows its command input once selected', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getAdapters).mockResolvedValue([
      { id: 'claude', installed: true, version: '1.2.3', gmail_guide: false },
      { id: 'codex', installed: false, message: 'codex not found', gmail_guide: true },
      { id: 'custom', installed: false, message: 'Enter a command', gmail_guide: true },
    ]);
    renderPage();
    const radio = await screen.findByRole('radio', { name: /custom/i });
    expect(screen.queryByLabelText('Custom command')).not.toBeInTheDocument();
    await user.click(radio);
    expect(radio).toBeChecked();
    expect(screen.getByLabelText('Custom command')).toBeInTheDocument();
  });

  it('links to the profiles screen after a successful save', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('radio', { name: /claude/i });
    expect(screen.queryByRole('link', { name: 'Continue to Profile' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('link', { name: 'Continue to Profiles' })).toHaveAttribute('href', '/');
  });
});
