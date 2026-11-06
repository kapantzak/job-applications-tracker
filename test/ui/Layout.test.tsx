import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from '../../src/ui/components/Layout.js';
import * as client from '../../src/ui/api/client.js';

vi.mock('../../src/ui/api/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/api/client.js')>()),
  listProposals: vi.fn(),
}));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/review']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="review" element={<p>review page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  document.documentElement.className = '';
  vi.mocked(client.listProposals).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.cookie = 'sidebar_state=; max-age=0; path=/';
});

describe('Layout', () => {
  it('renders the page and names the pending proposal count in the Review link', async () => {
    renderShell();
    expect(screen.getByText('review page')).toBeInTheDocument();
    const review = await screen.findByRole('link', { name: 'Review, 2 pending' });
    expect(review).toHaveAttribute('href', '/review');
    expect(review).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/jobs');
  });

  it('leaves Cmd/Ctrl+B to the browser and writes no sidebar cookie', async () => {
    renderShell();
    await screen.findByRole('link', { name: 'Review, 2 pending' });
    expect(fireEvent.keyDown(window, { key: 'b', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'b', ctrlKey: true })).toBe(true);
    expect(document.cookie).not.toContain('sidebar_state');
  });

  it('switches to the dark theme from the sidebar menu and remembers it', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Theme: System' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toBeInTheDocument();
  });
});
