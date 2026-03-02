import { describe, it, expect, afterEach, mock } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';

// Mock all store and hook dependencies
const mockSubscribe = mock();
const mockPush = mock();
const mockToast = mock();

mock.module('@/store/executionStore', () => ({
  useExecutionLifecycleStore: {
    subscribe: mockSubscribe,
  },
}));

mock.module('@/store/userPreferencesStore', () => ({
  useUserPreferencesStore: {
    getState: () => ({
      notifyOnRunComplete: true,
      notifyOnRunFailed: true,
    }),
  },
}));

mock.module('@/store/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({ push: mockPush }),
  },
}));

mock.module('@/hooks/useNotificationPermission', () => ({
  useNotificationPermission: () => ({
    permission: 'default' as const,
    requestPermission: mock(),
    isSupported: true,
  }),
}));

mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

mock.module('@/lib/logger', () => ({
  logger: { error: mock(), warn: mock(), info: mock(), debug: mock() },
}));

import { useNotifications } from '../useNotifications';

afterEach(() => {
  cleanup();
  mockSubscribe.mockReset();
  mockPush.mockReset();
  mockToast.mockReset();
});

describe('useNotifications', () => {
  it('subscribes to execution lifecycle store on mount', () => {
    mockSubscribe.mockReturnValue(() => {});

    renderHook(() => useNotifications());

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(typeof mockSubscribe.mock.calls[0][0]).toBe('function');
  });

  it('unsubscribes on unmount', () => {
    const unsubscribe = mock();
    mockSubscribe.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useNotifications());

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not notify on first observation of a run (initial status)', () => {
    mockSubscribe.mockImplementation((callback: (state: any) => void) => {
      // Simulate first observation
      callback({
        trackedRuns: [{ runId: 'run-1', status: 'running', workflowName: 'Test' }],
      });
      return () => {};
    });

    renderHook(() => useNotifications());

    // First observation should not trigger a notification
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('notifies via toast when run transitions to completed', () => {
    let callback: (state: any) => void;
    mockSubscribe.mockImplementation((cb: (state: any) => void) => {
      callback = cb;
      return () => {};
    });

    renderHook(() => useNotifications());

    // First observation — establishes baseline
    callback!({
      trackedRuns: [{ runId: 'run-1', status: 'running', workflowName: 'My Workflow' }],
    });

    // Second call — status changed to completed
    callback!({
      trackedRuns: [{ runId: 'run-1', status: 'completed', workflowName: 'My Workflow' }],
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Workflow completed',
        variant: 'success',
        runId: 'run-1',
      }),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('notifies via toast when run transitions to failed', () => {
    let callback: (state: any) => void;
    mockSubscribe.mockImplementation((cb: (state: any) => void) => {
      callback = cb;
      return () => {};
    });

    renderHook(() => useNotifications());

    callback!({
      trackedRuns: [{ runId: 'run-2', status: 'running', workflowName: 'Fail Flow' }],
    });

    callback!({
      trackedRuns: [{ runId: 'run-2', status: 'failed', workflowName: 'Fail Flow' }],
    });

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Workflow failed',
        variant: 'destructive',
        runId: 'run-2',
      }),
    );
  });

  it('does not duplicate notifications for the same run+status', () => {
    let callback: (state: any) => void;
    mockSubscribe.mockImplementation((cb: (state: any) => void) => {
      callback = cb;
      return () => {};
    });

    renderHook(() => useNotifications());

    callback!({
      trackedRuns: [{ runId: 'run-3', status: 'running', workflowName: 'Dup' }],
    });

    callback!({
      trackedRuns: [{ runId: 'run-3', status: 'completed', workflowName: 'Dup' }],
    });

    callback!({
      trackedRuns: [{ runId: 'run-3', status: 'completed', workflowName: 'Dup' }],
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
