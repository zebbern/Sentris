import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useIsMobile } from '../useIsMobile';

afterEach(cleanup);

describe('useIsMobile', () => {
  let listeners: Map<string, (e: MediaQueryListEvent) => void>;
  let currentMatches: boolean;

  beforeEach(() => {
    listeners = new Map();
    currentMatches = false;

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: currentMatches,
        media: query,
        addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
          listeners.set(query, handler);
        },
        removeEventListener: (_event: string) => {
          listeners.delete(query);
        },
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  it('returns false for desktop viewport widths', () => {
    currentMatches = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true for mobile viewport widths', () => {
    currentMatches = true;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('defaults to breakpoint of 768px', () => {
    currentMatches = false;
    renderHook(() => useIsMobile());
    expect(listeners.has('(max-width: 767px)')).toBe(true);
  });

  it('accepts a custom breakpoint', () => {
    currentMatches = false;
    renderHook(() => useIsMobile(1024));
    expect(listeners.has('(max-width: 1023px)')).toBe(true);
  });

  it('updates when the media query changes', () => {
    currentMatches = false;
    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);

    // Simulate media query change
    const handler = listeners.get('(max-width: 767px)');
    act(() => {
      handler?.({ matches: true } as MediaQueryListEvent);
    });

    expect(result.current).toBe(true);
  });

  it('cleans up event listener on unmount', () => {
    currentMatches = false;
    const { unmount } = renderHook(() => useIsMobile());

    expect(listeners.size).toBeGreaterThan(0);

    unmount();

    expect(listeners.size).toBe(0);
  });
});
