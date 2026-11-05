import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagInput } from '../../src/ui/components/TagInput.js';

afterEach(cleanup);

describe('TagInput', () => {
  it('commits pending text on blur, trimmed and deduped', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput label="Tags" value={['a']} onChange={onChange} />);
    await user.type(screen.getByLabelText('Tags'), ' b ');
    await user.tab();
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);

    onChange.mockClear();
    await user.type(screen.getByLabelText('Tags'), 'a');
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
  });
});
