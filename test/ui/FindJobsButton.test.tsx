import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FindJobsButton } from '../../src/ui/components/FindJobsButton.js';
import * as client from '../../src/ui/api/client.js';
import { DEFAULT_SETTINGS } from '../../src/server/db/settings-repo.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  getSettings: vi.fn(),
  listRuns: vi.fn(),
  getImportPrompt: vi.fn(),
  importJobs: vi.fn(),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
  vi.mocked(client.listRuns).mockResolvedValue([]);
});

function renderButton(props: { disabled?: boolean } = {}) {
  const onStart = vi.fn();
  const onImported = vi.fn();
  const user = userEvent.setup();
  const view = render(<FindJobsButton profileId="pf1" onStart={onStart} onImported={onImported} {...props} />);
  return { onStart, onImported, user, view };
}

async function chooseMode(user: ReturnType<typeof userEvent.setup>, name: 'Default' | 'Max effort') {
  await user.click(screen.getByRole('button', { name: 'Choose search mode' }));
  await user.click(await screen.findByRole('menuitemradio', { name }));
}

async function openCustom(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Choose search mode' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Custom search…' }));
}

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Choose search mode' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Import from another agent…' }));
}

describe('FindJobsButton', () => {
  it('starts on Default and runs a default search at once', async () => {
    const { onStart, user } = renderButton();
    await user.click(screen.getByRole('button', { name: 'Find jobs' }));
    expect(onStart).toHaveBeenCalledWith('default');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('lists both modes with the current one checked and a description each', async () => {
    const { user } = renderButton();
    await user.click(screen.getByRole('button', { name: 'Choose search mode' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitemradio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: 'Max effort' })).toHaveAttribute('aria-checked', 'false');
    expect(within(menu).getByText('One agent. Balances results and tokens.')).toBeInTheDocument();
    expect(
      within(menu).getByText('Five agents, one per source. Several times the tokens; asks before it starts.'),
    ).toBeInTheDocument();
  });

  it('choosing Max effort only relabels the main button and starts nothing', async () => {
    const { onStart, user } = renderButton();
    await chooseMode(user, 'Max effort');
    expect(screen.getByRole('button', { name: 'Find jobs with max effort' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Find jobs' })).not.toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('in Max effort the main button asks first and starts a max search only on confirm', async () => {
    const { onStart, user } = renderButton();
    await chooseMode(user, 'Max effort');
    await user.click(screen.getByRole('button', { name: 'Find jobs with max effort' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Start a Max-effort search?' });
    expect(onStart).not.toHaveBeenCalled();
    await user.click(await within(dialog).findByRole('button', { name: 'Start Max-effort search' }));
    expect(onStart).toHaveBeenCalledWith('max');
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('cancelling the warning starts nothing and keeps Max effort selected', async () => {
    const { onStart, user } = renderButton();
    await chooseMode(user, 'Max effort');
    await user.click(screen.getByRole('button', { name: 'Find jobs with max effort' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Start a Max-effort search?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Find jobs with max effort' })).toBeInTheDocument();
  });

  it('loads fresh details each time the warning opens', async () => {
    const { user } = renderButton();
    await chooseMode(user, 'Max effort');
    const main = screen.getByRole('button', { name: 'Find jobs with max effort' });
    await user.click(main);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    await user.click(main);
    await screen.findByRole('alertdialog');
    expect(client.getSettings).toHaveBeenCalledTimes(2);
    expect(client.listRuns).toHaveBeenCalledTimes(2);
  });

  it('still lets the user start when the warning details fail to load', async () => {
    vi.mocked(client.listRuns).mockRejectedValue(new Error('runs down'));
    const { onStart, user } = renderButton();
    await chooseMode(user, 'Max effort');
    await user.click(screen.getByRole('button', { name: 'Find jobs with max effort' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Start a Max-effort search?' });
    expect(await within(dialog).findByText('Could not load the search details: runs down')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Start Max-effort search' }));
    expect(onStart).toHaveBeenCalledWith('max');
  });

  it('switching back to Default runs a default search again', async () => {
    const { onStart, user } = renderButton();
    await chooseMode(user, 'Max effort');
    await chooseMode(user, 'Default');
    await user.click(screen.getByRole('button', { name: 'Find jobs' }));
    expect(onStart).toHaveBeenCalledWith('default');
  });

  it('a new mount starts on Default again', async () => {
    const { user, view } = renderButton();
    await chooseMode(user, 'Max effort');
    view.unmount();
    renderButton();
    expect(screen.getByRole('button', { name: 'Find jobs' })).toBeInTheDocument();
  });

  it('starts nothing from the main button with custom text typed earlier', async () => {
    const { onStart, user } = renderButton();
    await openCustom(user);
    const dialog = await screen.findByRole('dialog', { name: 'Custom search' });
    await user.type(within(dialog).getByLabelText('Instructions'), 'Only fintech');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Find jobs' }));
    expect(onStart).toHaveBeenCalledWith('default');
  });

  it('a custom search starts on the current mode, needs text, and sends it trimmed', async () => {
    const { onStart, user } = renderButton();
    await openCustom(user);
    const dialog = await screen.findByRole('dialog', { name: 'Custom search' });
    expect(within(dialog).getByRole('radio', { name: 'Default' })).toBeChecked();
    const start = within(dialog).getByRole('button', { name: 'Start search' });
    expect(start).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Instructions'), '   ');
    expect(start).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Instructions'), 'Only fintech companies ');
    expect(within(dialog).getByText('26 / 2000')).toBeInTheDocument();
    await user.click(start);
    expect(onStart).toHaveBeenCalledWith('default', 'Only fintech companies');
    expect(screen.queryByRole('dialog', { name: 'Custom search' })).not.toBeInTheDocument();
  });

  it('a new custom search follows the menu mode once the old text is cleared', async () => {
    const { user } = renderButton();
    await openCustom(user);
    let dialog = await screen.findByRole('dialog', { name: 'Custom search' });
    await user.click(within(dialog).getByRole('radio', { name: 'Max effort' }));
    await user.type(within(dialog).getByLabelText('Instructions'), 'Only fintech');
    await user.clear(within(dialog).getByLabelText('Instructions'));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await openCustom(user);
    dialog = await screen.findByRole('dialog', { name: 'Custom search' });
    expect(within(dialog).getByRole('radio', { name: 'Default' })).toBeChecked();
  });

  it('caps the instructions at 2000 characters', async () => {
    const { user } = renderButton();
    await openCustom(user);
    const field = within(await screen.findByRole('dialog', { name: 'Custom search' })).getByLabelText('Instructions');
    expect(field).toHaveAttribute('maxLength', '2000');
  });

  it('a custom Max search asks first and starts with the instructions only on confirm', async () => {
    const { onStart, user } = renderButton();
    await chooseMode(user, 'Max effort');
    await openCustom(user);
    const dialog = await screen.findByRole('dialog', { name: 'Custom search' });
    expect(within(dialog).getByRole('radio', { name: 'Max effort' })).toBeChecked();
    await user.type(within(dialog).getByLabelText('Instructions'), 'Only fintech');
    await user.click(within(dialog).getByRole('button', { name: 'Start search' }));
    const warning = await screen.findByRole('alertdialog', { name: 'Start a Max-effort search?' });
    expect(onStart).not.toHaveBeenCalled();
    await user.click(await within(warning).findByRole('button', { name: 'Start Max-effort search' }));
    expect(onStart).toHaveBeenCalledWith('max', 'Only fintech');
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('cancelling the Max warning of a custom search keeps the text and leaves a later plain Max search plain', async () => {
    const { onStart, user } = renderButton();
    await openCustom(user);
    let dialog = await screen.findByRole('dialog', { name: 'Custom search' });
    await user.click(within(dialog).getByRole('radio', { name: 'Max effort' }));
    await user.type(within(dialog).getByLabelText('Instructions'), 'Only fintech');
    await user.click(within(dialog).getByRole('button', { name: 'Start search' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(onStart).not.toHaveBeenCalled();
    // The menu mode was not changed by the dialog's choice.
    expect(screen.getByRole('button', { name: 'Find jobs' })).toBeInTheDocument();

    await openCustom(user);
    dialog = await screen.findByRole('dialog', { name: 'Custom search' });
    expect(within(dialog).getByLabelText('Instructions')).toHaveValue('Only fintech');
    // Resuming keeps the mode chosen in the dialog, not the menu's Default.
    expect(within(dialog).getByRole('radio', { name: 'Max effort' })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await chooseMode(user, 'Max effort');
    await user.click(screen.getByRole('button', { name: 'Find jobs with max effort' }));
    await user.click(await within(await screen.findByRole('alertdialog')).findByRole('button', { name: 'Start Max-effort search' }));
    expect(onStart).toHaveBeenCalledWith('max');
  });

  it('copies the search prompt, with the optional instructions, and says so', async () => {
    vi.mocked(client.getImportPrompt).mockResolvedValue({ prompt: 'SEARCH PROMPT', version: '5' });
    const { user } = renderButton();
    await openImport(user);
    const dialog = await screen.findByRole('dialog', { name: 'Import from another agent' });
    await user.click(within(dialog).getByRole('button', { name: 'Copy prompt' }));
    expect(await within(dialog).findByText('Prompt copied. Paste it into your agent.')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('SEARCH PROMPT');
    expect(client.getImportPrompt).toHaveBeenLastCalledWith('pf1', undefined);
    await user.type(within(dialog).getByLabelText('Instructions (optional)'), ' Only fintech ');
    await user.click(within(dialog).getByRole('button', { name: 'Copy prompt' }));
    await vi.waitFor(() => expect(client.getImportPrompt).toHaveBeenLastCalledWith('pf1', 'Only fintech'));
  });

  it('shows the prompt to copy by hand when the clipboard refuses', async () => {
    vi.mocked(client.getImportPrompt).mockResolvedValue({ prompt: 'SEARCH PROMPT', version: '5' });
    const { user } = renderButton();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await openImport(user);
    const dialog = await screen.findByRole('dialog', { name: 'Import from another agent' });
    await user.click(within(dialog).getByRole('button', { name: 'Copy prompt' }));
    const manual = await within(dialog).findByLabelText(
      'Copying is not available here. Select the prompt and copy it.',
    );
    expect(manual).toHaveValue('SEARCH PROMPT');
    expect(manual).toHaveAttribute('readonly');
  });

  it('imports the pasted answer with the instructions and hands back the run', async () => {
    vi.mocked(client.importJobs).mockResolvedValue({ id: 'run-import' } as never);
    const { onImported, onStart, user } = renderButton();
    await openImport(user);
    const dialog = await screen.findByRole('dialog', { name: 'Import from another agent' });
    const importButton = within(dialog).getByRole('button', { name: 'Import jobs' });
    expect(importButton).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Instructions (optional)'), 'Only fintech');
    await user.click(within(dialog).getByLabelText('Agent answer'));
    await user.paste('Here you go: {"jobs": []}');
    await user.click(importButton);
    expect(client.importJobs).toHaveBeenCalledWith('pf1', 'Here you go: {"jobs": []}', 'Only fintech');
    expect(onImported).toHaveBeenCalledWith({ id: 'run-import' });
    expect(onStart).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Import from another agent' })).not.toBeInTheDocument(),
    );
  });

  it('records the instructions the copied prompt carried, not ones typed afterwards', async () => {
    vi.mocked(client.getImportPrompt).mockResolvedValue({ prompt: 'SEARCH PROMPT', version: '5' });
    vi.mocked(client.importJobs).mockResolvedValue({ id: 'run-import' } as never);
    const { user } = renderButton();
    await openImport(user);
    const dialog = await screen.findByRole('dialog', { name: 'Import from another agent' });
    const instructions = within(dialog).getByLabelText('Instructions (optional)');
    await user.type(instructions, 'Only fintech');
    await user.click(within(dialog).getByRole('button', { name: 'Copy prompt' }));
    await within(dialog).findByText('Prompt copied. Paste it into your agent.');
    await user.clear(instructions);
    // The copied state no longer matches what is typed.
    expect(within(dialog).queryByText('Prompt copied. Paste it into your agent.')).not.toBeInTheDocument();
    await user.click(within(dialog).getByLabelText('Agent answer'));
    await user.paste('{"jobs": []}');
    await user.click(within(dialog).getByRole('button', { name: 'Import jobs' }));
    expect(client.importJobs).toHaveBeenCalledWith('pf1', '{"jobs": []}', 'Only fintech');
  });

  it('clears an old error when the dialog opens again', async () => {
    vi.mocked(client.getImportPrompt).mockRejectedValue(new Error('Profile not found'));
    const { user } = renderButton();
    await openImport(user);
    let dialog = await screen.findByRole('dialog', { name: 'Import from another agent' });
    await user.click(within(dialog).getByRole('button', { name: 'Copy prompt' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await openImport(user);
    dialog = await screen.findByRole('dialog', { name: 'Import from another agent' });
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the dialog open with the error when the import is refused', async () => {
    vi.mocked(client.importJobs).mockRejectedValue(new Error('There are no jobs to import'));
    const { onImported, user } = renderButton();
    await openImport(user);
    const dialog = await screen.findByRole('dialog', { name: 'Import from another agent' });
    await user.click(within(dialog).getByLabelText('Agent answer'));
    await user.paste('{"jobs": []}');
    await user.click(within(dialog).getByRole('button', { name: 'Import jobs' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('There are no jobs to import');
    expect(onImported).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Agent answer')).toHaveValue('{"jobs": []}');
  });

  it('shows why the prompt could not be loaded', async () => {
    vi.mocked(client.getImportPrompt).mockRejectedValue(new Error('Profile not found'));
    const { user } = renderButton();
    await openImport(user);
    const dialog = await screen.findByRole('dialog', { name: 'Import from another agent' });
    await user.click(within(dialog).getByRole('button', { name: 'Copy prompt' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Profile not found');
  });

  it('turns both parts off when disabled', () => {
    renderButton({ disabled: true });
    expect(screen.getByRole('button', { name: 'Find jobs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose search mode' })).toBeDisabled();
  });
});
