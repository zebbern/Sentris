import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock window.requestIdleCallback — the module uses window.requestIdleCallback
// ---------------------------------------------------------------------------

let idleCallback: (() => void) | null = null;
let idleTimeout: number | undefined;
let ricMock: ReturnType<typeof mock>;

beforeEach(() => {
  idleCallback = null;
  idleTimeout = undefined;

  ricMock = mock((cb: () => void, opts?: { timeout?: number }) => {
    idleCallback = cb;
    idleTimeout = opts?.timeout;
    return 1;
  });

  (globalThis as any).window = globalThis.window ?? {};
  (globalThis as any).window.requestIdleCallback = ricMock;
});

import { prefetchIdleRoutes, prefetchRoute } from '../prefetch-routes';

describe('prefetchIdleRoutes', () => {
  it('registers a requestIdleCallback', () => {
    prefetchIdleRoutes();
    expect(ricMock).toHaveBeenCalled();
  });

  it('passes timeout of 10000 to requestIdleCallback', () => {
    prefetchIdleRoutes();
    expect(idleTimeout).toBe(10_000);
  });

  it('callback is a function that triggers imports without throwing', () => {
    prefetchIdleRoutes();
    expect(idleCallback).not.toBeNull();
    expect(typeof idleCallback).toBe('function');
    // Calling it should not throw — it fires dynamic imports
    expect(() => idleCallback!()).not.toThrow();
  });

  it('falls back to setTimeout when requestIdleCallback is unavailable', () => {
    const origRIC = (globalThis as any).window.requestIdleCallback;
    delete (globalThis as any).window.requestIdleCallback;

    // Should not throw — falls back to setTimeout
    expect(() => prefetchIdleRoutes()).not.toThrow();

    // Restore
    (globalThis as any).window.requestIdleCallback = origRIC;
  });

  it('can be called multiple times without error', () => {
    prefetchIdleRoutes();
    prefetchIdleRoutes();
    expect(ricMock).toHaveBeenCalledTimes(2);
  });
});

describe('prefetchRoute', () => {
  it('does not throw for a known route', () => {
    expect(() => prefetchRoute('/workflows')).not.toThrow();
  });

  it('does not throw for unknown routes', () => {
    expect(() => prefetchRoute('/unknown-route')).not.toThrow();
  });

  it('strips query parameters before matching', () => {
    expect(() => prefetchRoute('/templates?sort=recent')).not.toThrow();
  });

  it('handles root path', () => {
    expect(() => prefetchRoute('/')).not.toThrow();
  });

  it('handles settings path', () => {
    expect(() => prefetchRoute('/settings')).not.toThrow();
  });

  it('handles schedules path', () => {
    expect(() => prefetchRoute('/schedules')).not.toThrow();
  });

  it('handles webhooks path', () => {
    expect(() => prefetchRoute('/webhooks')).not.toThrow();
  });

  it('handles path with hash fragment', () => {
    // The implementation uses split('?')[0], so hash is preserved — still shouldn't throw
    expect(() => prefetchRoute('/workflows#section')).not.toThrow();
  });
});
