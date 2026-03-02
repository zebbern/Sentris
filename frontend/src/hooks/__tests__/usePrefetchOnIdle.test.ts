import { describe, it, expect, afterEach, beforeEach, mock } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';
import { createQueryKeysMock } from '@/test/mocks/queryKeysMock';

// Mock all dependencies before importing the hook
mock.module('@/lib/queryClient', () => ({
  queryClient: {
    prefetchQuery: mock(),
  },
}));
mock.module('@/lib/queryKeys', () =>
  createQueryKeysMock({
    components: { all: () => ['components'] },
    workflows: { summary: () => ['workflows', 'summary'] },
    templates: { all: () => ['templates'] },
  }),
);
mock.module('@/services/api', () => ({
  api: {
    workflows: { listSummary: mock() },
    templates: { list: mock() },
  },
}));
mock.module('@/hooks/queries/useComponentQueries', () => ({
  fetchComponentIndex: mock(),
}));

const mockIsAuthenticated = { value: true };
mock.module('@/auth/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated.value }),
}));

import { usePrefetchOnIdle } from '../usePrefetchOnIdle';
import { queryClient } from '@/lib/queryClient';

// Module-level originals so afterEach can always access them
let savedRequestIdleCallback: typeof window.requestIdleCallback;
let savedCancelIdleCallback: typeof window.cancelIdleCallback;
let savedOnLine: PropertyDescriptor | undefined;

// jsdom doesn't provide requestIdleCallback/cancelIdleCallback; install no-ops once
// so the hook's cleanup never hits `undefined`.
if (typeof window.requestIdleCallback !== 'function') {
  (window as any).requestIdleCallback = () => 0;
}
if (typeof window.cancelIdleCallback !== 'function') {
  (window as any).cancelIdleCallback = () => {};
}

beforeEach(() => {
  savedRequestIdleCallback = window.requestIdleCallback;
  savedCancelIdleCallback = window.cancelIdleCallback;
  savedOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (queryClient.prefetchQuery as ReturnType<typeof mock>).mockReset();
  mockIsAuthenticated.value = true;
});

afterEach(() => {
  // Run cleanup FIRST while mocks are still in place, then restore originals
  cleanup();
  window.requestIdleCallback = savedRequestIdleCallback;
  window.cancelIdleCallback = savedCancelIdleCallback;
  if (savedOnLine) {
    Object.defineProperty(navigator, 'onLine', savedOnLine);
  }
});

describe('usePrefetchOnIdle', () => {
  it('calls requestIdleCallback when authenticated and API is available', () => {
    const idleCallback = mock().mockReturnValue(1);
    window.requestIdleCallback = idleCallback;
    window.cancelIdleCallback = mock();

    renderHook(() => usePrefetchOnIdle());

    expect(idleCallback).toHaveBeenCalledTimes(1);
    expect(typeof idleCallback.mock.calls[0][0]).toBe('function');
  });

  it('invokes prefetch queries when idle callback fires', () => {
    let capturedCallback: (() => void) | undefined;
    window.requestIdleCallback = mock().mockImplementation((cb: () => void) => {
      capturedCallback = cb;
      return 1;
    });
    window.cancelIdleCallback = mock();

    renderHook(() => usePrefetchOnIdle());

    capturedCallback?.();

    expect(queryClient.prefetchQuery).toHaveBeenCalledTimes(3);
  });

  it('falls back to setTimeout when requestIdleCallback is unavailable', () => {
    // Remove requestIdleCallback
    (window as any).requestIdleCallback = undefined;

    const { unmount } = renderHook(() => usePrefetchOnIdle());

    // The fallback uses setTimeout with 2000ms; just verify clean unmount
    unmount();
  });

  it('does not prefetch when not authenticated', () => {
    mockIsAuthenticated.value = false;
    const idleCallback = mock().mockReturnValue(1);
    window.requestIdleCallback = idleCallback;
    window.cancelIdleCallback = mock();

    renderHook(() => usePrefetchOnIdle());

    expect(idleCallback).not.toHaveBeenCalled();
  });

  it('cancels idle callback on unmount', () => {
    const cancelMock = mock();
    window.requestIdleCallback = mock().mockReturnValue(42);
    window.cancelIdleCallback = cancelMock;

    const { unmount } = renderHook(() => usePrefetchOnIdle());

    unmount();

    expect(cancelMock).toHaveBeenCalledWith(42);
  });

  it('does not prefetch when browser is offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    let capturedCallback: (() => void) | undefined;
    window.requestIdleCallback = mock().mockImplementation((cb: () => void) => {
      capturedCallback = cb;
      return 1;
    });
    window.cancelIdleCallback = mock();

    renderHook(() => usePrefetchOnIdle());

    capturedCallback?.();

    expect(queryClient.prefetchQuery).not.toHaveBeenCalled();
  });
});
