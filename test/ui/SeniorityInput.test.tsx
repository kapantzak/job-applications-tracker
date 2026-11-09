import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SeniorityInput } from '../../src/ui/components/SeniorityInput.js';

// Shows the saved text so tests assert what the profile form would send.
function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SeniorityInput value={value} onChange={setValue} />
      <output aria-label="saved">{value}</output>
    </>
  );
}

afterEach(cleanup);

describe('SeniorityInput', () => {
  it('offers the ten levels as toggles and saves the chosen ones in ladder order', async () => {
    const user = userEvent.setup();
    render(<Harness initial="" />);
    // Toggles only: the group also has an ⓘ help button, which has no pressed state.
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: 'Staff' }));
    await user.click(screen.getByRole('button', { name: 'Senior' }));
    expect(screen.getByRole('button', { name: 'Senior' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('saved')).toHaveTextContent('Senior, Staff');
    await user.click(screen.getByRole('button', { name: 'Staff' }));
    expect(screen.getByLabelText('saved')).toHaveTextContent(/^Senior$/);
  });

  it('adds other text after the levels', async () => {
    const user = userEvent.setup();
    render(<Harness initial="Lead" />);
    await user.type(screen.getByLabelText('Other'), 'tech lead');
    expect(screen.getByLabelText('Other')).toHaveValue('tech lead');
    expect(screen.getByLabelText('saved')).toHaveTextContent('Lead, tech lead');
  });

  it('shows an older free-text value in Other and leaves it unchanged', () => {
    render(<Harness initial="Senior, ideally Staff" />);
    expect(screen.getByRole('button', { name: 'Senior' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Staff' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Other')).toHaveValue('ideally Staff');
    expect(screen.getByLabelText('saved')).toHaveTextContent('Senior, ideally Staff');
  });
});
