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
      'README.md#gmail-access-for-other-agents',
    );
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
});
