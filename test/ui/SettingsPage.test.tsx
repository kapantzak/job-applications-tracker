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
  getModelCatalogs: vi.fn(),
  purgeRunLogs: vi.fn(),
}));

const CATALOGS = {
  claude: {
    source: 'static' as const,
    models: [{ id: 'opus', label: 'opus', efforts: ['low', 'high', 'max'] }],
    efforts: ['low', 'high', 'max'],
  },
  codex: {
    source: 'agent' as const,
    models: [
      { id: 'model-a', label: 'Model A', efforts: ['low', 'medium'] },
      { id: 'model-b', label: 'Model B', efforts: ['high', 'ultra'] },
    ],
    efforts: ['low', 'medium', 'high', 'ultra'],
  },
};

const settings = {
  adapter_id: 'claude',
  custom_command: '',
  permission_mode_discover: 'plan',
  permission_mode_sync: 'plan',
  allowed_tools_discover: 'a',
  allowed_tools_sync: 'b',
  sandbox_discover: 'read-only',
  sandbox_sync: 'read-only',
  claude_model_discover: 'opus',
  claude_model_sync: '',
  claude_effort_discover: '',
  claude_effort_sync: 'low',
  codex_model_discover: '',
  codex_model_sync: '',
  codex_effort_discover: '',
  codex_effort_sync: '',
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
  vi.mocked(client.getModelCatalogs).mockResolvedValue(CATALOGS);
});

const effortOptions = (label: string) =>
  within(screen.getByLabelText(label)).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);

describe('SettingsPage model and effort', () => {
  it('saves model and effort per run kind with the agent section', async () => {
    const user = userEvent.setup();
    renderPage();
    const discoverModel = await screen.findByLabelText('Model (discovery)');
    expect(discoverModel).toHaveValue('opus');
    await user.type(screen.getByLabelText('Model (mail sync)'), 'sonnet');
    await user.selectOptions(screen.getByLabelText('Effort (discovery)'), 'high');
    const section = screen.getByRole('region', { name: 'Agent' });
    await user.click(within(section).getByRole('button', { name: 'Save' }));
    expect(client.patchSettings).toHaveBeenCalledWith({
      adapter_id: 'claude',
      custom_command: '',
      claude_model_discover: 'opus',
      claude_model_sync: 'sonnet',
      claude_effort_discover: 'high',
      claude_effort_sync: 'low',
      codex_model_discover: '',
      codex_model_sync: '',
      codex_effort_discover: '',
      codex_effort_sync: '',
    });
  });

  it('offers agent default first and suggests the catalog models', async () => {
    renderPage();
    await screen.findByLabelText('Model (discovery)');
    expect(effortOptions('Effort (discovery)')).toEqual(['', 'low', 'high', 'max']);
    expect(within(screen.getByLabelText('Effort (discovery)')).getByRole('option', { name: 'Agent default' })).toHaveValue('');
    const list = document.getElementById(screen.getByLabelText('Model (discovery)').getAttribute('list') ?? '');
    expect([...(list?.querySelectorAll('option') ?? [])].map((o) => o.value)).toEqual(['opus']);
  });

  it('limits codex effort levels to what the chosen model supports and warns about ultra', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getAdapters).mockResolvedValue([
      { id: 'claude', installed: true, gmail_guide: false },
      { id: 'codex', installed: true, gmail_guide: true },
    ]);
    renderPage();
    await user.click(await screen.findByRole('radio', { name: /codex/ }));
    await user.type(screen.getByLabelText('Model (discovery)'), 'model-b');
    expect(effortOptions('Effort (discovery)')).toEqual(['', 'high', 'ultra']);
    await user.selectOptions(screen.getByLabelText('Effort (discovery)'), 'ultra');
    expect(screen.getByText(/Ultra delegates work to subagents/)).toBeInTheDocument();
    // A model the catalog does not know gets every level the agent listed.
    await user.type(screen.getByLabelText('Model (mail sync)'), 'model-z');
    expect(effortOptions('Effort (mail sync)')).toEqual(['', 'low', 'medium', 'high', 'ultra']);
  });

  it('says when the chosen model does not list the selected effort', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getSettings).mockResolvedValue({
      ...settings,
      adapter_id: 'codex',
      codex_model_discover: 'model-b',
      codex_effort_discover: 'ultra',
    } as never);
    vi.mocked(client.getAdapters).mockResolvedValue([{ id: 'codex', installed: true, gmail_guide: true }]);
    renderPage();
    const model = await screen.findByLabelText('Model (discovery)');
    expect(screen.queryByText(/does not list ultra/)).not.toBeInTheDocument();
    await user.clear(model);
    await user.type(model, 'model-a');
    expect(screen.getByLabelText('Effort (discovery)')).toHaveValue('ultra');
    expect(screen.getByText('model-a does not list ultra; the run may fail.')).toBeInTheDocument();
  });

  it('warns that max effort makes runs slower', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText('Effort (discovery)'), 'max');
    expect(screen.getByText(/Higher effort makes runs slower/)).toBeInTheDocument();
  });

  it('keeps a stored effort the catalog does not list', async () => {
    vi.mocked(client.getSettings).mockResolvedValue({ ...settings, claude_effort_sync: 'xhigh' } as never);
    renderPage();
    await screen.findByLabelText('Effort (mail sync)');
    expect(screen.getByLabelText('Effort (mail sync)')).toHaveValue('xhigh');
  });

  it('points custom commands to their own flags', async () => {
    vi.mocked(client.getSettings).mockResolvedValue({ ...settings, adapter_id: 'custom', custom_command: 'x' } as never);
    vi.mocked(client.getAdapters).mockResolvedValue([{ id: 'custom', installed: true, gmail_guide: true }]);
    renderPage();
    expect(await screen.findByText(/set them in your custom command/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Model (discovery)')).not.toBeInTheDocument();
  });

  it('still lets the user type a model when the catalogs cannot be loaded', async () => {
    vi.mocked(client.getModelCatalogs).mockRejectedValue(new Error('catalog down'));
    renderPage();
    expect(await screen.findByLabelText('Model (discovery)')).toHaveValue('opus');
    expect(effortOptions('Effort (discovery)')).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('says when the codex model list could not be read', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getModelCatalogs).mockResolvedValue({
      ...CATALOGS,
      codex: { source: 'unavailable', models: [], efforts: [] },
    });
    vi.mocked(client.getAdapters).mockResolvedValue([
      { id: 'claude', installed: true, gmail_guide: false },
      { id: 'codex', installed: true, gmail_guide: true },
    ]);
    renderPage();
    await user.click(await screen.findByRole('radio', { name: /codex/ }));
    expect(screen.getByText(/Could not read the codex model list/i)).toBeInTheDocument();
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
    // Nothing is deleted until the confirmation dialog is accepted.
    expect(client.purgeRunLogs).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog', { name: 'Purge run logs?' });
    await user.click(within(dialog).getByRole('button', { name: 'Purge logs' }));
    expect(client.purgeRunLogs).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Deleted 3 run logs and directories')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps run logs when the purge confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Purge run logs' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Purge run logs?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(client.purgeRunLogs).not.toHaveBeenCalled();
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
