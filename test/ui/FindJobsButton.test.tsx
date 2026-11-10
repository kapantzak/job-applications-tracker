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
}));

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(client.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
  vi.mocked(client.listRuns).mockResolvedValue([]);
});

function renderButton(props: { disabled?: boolean } = {}) {
  const onStart = vi.fn();
  const user = userEvent.setup();
  const view = render(<FindJobsButton profileId="pf1" onStart={onStart} {...props} />);
  return { onStart, user, view };
}

async function chooseMode(user: ReturnType<typeof userEvent.setup>, name: 'Default' | 'Max effort') {
  await user.click(screen.getByRole('button', { name: 'Choose search mode' }));
  await user.click(await screen.findByRole('menuitemradio', { name }));
}

async function openCustom(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Choose search mode' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Custom search…' }));
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

  it('turns both parts off when disabled', () => {
    renderButton({ disabled: true });
    expect(screen.getByRole('button', { name: 'Find jobs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose search mode' })).toBeDisabled();
  });
});
