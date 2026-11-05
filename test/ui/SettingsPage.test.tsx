import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../../src/ui/pages/SettingsPage.js';
import * as client from '../../src/ui/api/client.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  getAdapters: vi.fn(),
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
  getHealth: vi.fn(),
  purgeRunLogs: vi.fn(),
}));

const settings = {
  adapter_id: 'claude',
  custom_command: '',
  permission_mode_discover: 'plan',
  permission_mode_sync: 'plan',
  allowed_tools_discover: 'a',
  allowed_tools_sync: 'b',
  sandbox_discover: 'read-only',
  sandbox_sync: 'read-only',
  run_timeout_ms: 600000,
  sync_interval: 'off',
  port: 4000,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.getAdapters).mockResolvedValue([{ id: 'claude', installed: true, gmail_guide: false }]);
  vi.mocked(client.getSettings).mockResolvedValue(settings as never);
  vi.mocked(client.patchSettings).mockResolvedValue(settings as never);
  vi.mocked(client.getHealth).mockResolvedValue({
    ok: true,
    version: '1',
    dataDir: '/data/jt',
  });
});

describe('SettingsPage', () => {
  it('saves only the runs section keys', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText('Sync interval'), '6h');
    const section = screen.getByRole('region', { name: 'Runs' });
    await user.click(within(section).getByRole('button', { name: 'Save' }));
    expect(client.patchSettings).toHaveBeenCalledWith({
      run_timeout_ms: 600000,
      sync_interval: '6h',
    });
    expect(await within(section).findByText('Saved')).toBeInTheDocument();
  });

  it('shows the data dir and purges run logs', async () => {
    const user = userEvent.setup();
    vi.mocked(client.purgeRunLogs).mockResolvedValue({ deleted: 3 });
    renderPage();
    expect(await screen.findByText('/data/jt')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Purge run logs' }));
    expect(client.purgeRunLogs).toHaveBeenCalled();
    expect(await screen.findByText('Deleted 3 run logs and directories')).toBeInTheDocument();
  });

  it('surfaces a validation error in its own section', async () => {
    const user = userEvent.setup();
    vi.mocked(client.patchSettings).mockRejectedValue(new Error('port invalid'));
    renderPage();
    await screen.findByLabelText('Port');
    const section = screen.getByRole('region', { name: 'Server' });
    await user.click(within(section).getByRole('button', { name: 'Save' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('port invalid');
  });
});
