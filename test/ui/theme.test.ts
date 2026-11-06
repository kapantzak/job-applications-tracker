import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readStoredTheme, THEME_STORAGE_KEY, useTheme } from '../../src/ui/theme.js';

type Listener = () => void;

// jsdom has no matchMedia; this stub lets a test flip the OS preference and fire change events.
function stubMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return dark;
      },
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    })),
  );
  return {
    setDark(next: boolean) {
      dark = next;
      listeners.forEach((l) => l());
    },
    listenerCount: () => listeners.size,
  };
}

const isDark = () => document.documentElement.classList.contains('dark');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('defaults to system when nothing or something invalid is stored', () => {
    expect(readStoredTheme()).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readStoredTheme()).toBe('system');
  });

  it('falls back to system when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredTheme()).toBe('system');
  });

  it('applies dark and light explicitly regardless of the OS preference', () => {
    stubMatchMedia(true);
    applyTheme('light');
    expect(isDark()).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
    applyTheme('dark');
    expect(isDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('stores the chosen theme and applies it', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('system');
    act(() => result.current[1]('dark'));
    expect(result.current[0]).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(isDark()).toBe(true);
  });

  it('follows OS changes only in system mode', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(isDark()).toBe(false);
    act(() => media.setDark(true));
    expect(isDark()).toBe(true);

    act(() => result.current[1]('light'));
    expect(media.listenerCount()).toBe(0);
    act(() => media.setDark(true));
    expect(isDark()).toBe(false);
  });
});
