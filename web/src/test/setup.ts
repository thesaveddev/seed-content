import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Clean up DOM + testing-library between tests
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom lacks matchMedia — the landing/theme code references it
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom lacks scrollTo
if (typeof window !== 'undefined' && !('scrollTo' in window)) {
  (window as any).scrollTo = vi.fn();
}
