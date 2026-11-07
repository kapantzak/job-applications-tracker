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

  it('turns both parts off when disabled', () => {
    renderButton({ disabled: true });
    expect(screen.getByRole('button', { name: 'Find jobs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose search mode' })).toBeDisabled();
  });
});
