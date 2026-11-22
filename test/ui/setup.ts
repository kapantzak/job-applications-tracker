import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Radix primitives (radio group, checkbox) measure elements with ResizeObserver, which jsdom does not provide.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Pages save views in localStorage (SOW-0054), and jsdom keeps it for the whole file; start every test empty.
afterEach(() => {
  window.localStorage.clear();
});
