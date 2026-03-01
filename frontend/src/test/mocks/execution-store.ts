/**
 * Shared Zustand-compatible executionStore mock factory.
 *
 * Usage:
 * ```ts
 * import { createExecutionStoreMock } from '@/test/mocks/execution-store';
 * mock.module('@/store/executionStore', () => createExecutionStoreMock());
 * ```
 *
 * Produces a `useExecutionStore` hook with:
 *  - Selector pattern: `useExecutionStore(s => s.runId)`
 *  - Zustand static API: `.setState()`, `.getState()`, `.subscribe()`, `.destroy()`
 *  - All fields used by consumers: reset, getTerminalSession, trackedRuns, etc.
 */

import { mock as bunMock } from 'bun:test';

export function createExecutionStoreMock() {
  // eslint-disable-next-line prefer-const
  let _state: Record<string, any>;

  const _setState = (partial: any) => {
    const next = typeof partial === 'function' ? partial(_state) : partial;
    Object.assign(_state, next);
  };

  const _initialState = {
    runId: null as string | null,
    workflowId: null as string | null,
    status: null as string | null,
    runStatus: null as any,
    traceEvents: [] as any[],
    trackedRuns: [] as any[],
    isStreaming: false,
    streamError: null as any,
    pollingInterval: null as any,
  };

  _state = {
    ..._initialState,

    // Actions
    reset: () => {
      Object.assign(_state, {
        runId: null,
        workflowId: null,
        status: null,
        runStatus: null,
        traceEvents: [],
        isStreaming: false,
        streamError: null,
      });
    },
    getTerminalSession: (_nodeId: string, _stream = 'pty') => null,
    monitorRun: bunMock(() => {}),
    switchToRun: bunMock(() => {}),
    addTrackedRun: bunMock(() => {}),
    removeTrackedRun: bunMock(() => {}),
    connectStream: bunMock(() => {}),
    disconnectStream: bunMock(() => {}),
  };

  const useExecutionStore = ((selector?: any) => {
    return selector ? selector(_state) : _state;
  }) as any;

  useExecutionStore.setState = _setState;
  useExecutionStore.getState = () => _state;
  useExecutionStore.subscribe = () => () => {};
  useExecutionStore.destroy = () => {};

  // Also export as useExecutionLifecycleStore for compatibility
  return {
    useExecutionStore,
    useExecutionLifecycleStore: useExecutionStore,
  };
}
