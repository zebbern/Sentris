import { describe, it, expect, afterEach, mock } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';

// Create mock store selectors
const mockState = {
  workflowId: null as string | null,
  runId: null as string | null,
  status: 'idle' as string,
  runStatus: null as any,
  nodeStates: {} as Record<string, any>,
  startExecution: mock(),
  stopExecution: mock(),
  reset: mock(),
};

mock.module('@/store/executionStore', () => ({
  useExecutionStore: (selector: (s: typeof mockState) => any) => selector(mockState),
}));

mock.module('@/store/workflowStore', () => ({
  useWorkflowStore: (selector: (s: any) => any) => selector({ metadata: { id: 'wf-1' } }),
}));

import { useWorkflowExecution } from '../useWorkflowExecution';

afterEach(() => {
  cleanup();
  mockState.workflowId = null;
  mockState.runId = null;
  mockState.status = 'idle';
  mockState.runStatus = null;
  mockState.nodeStates = {};
});

describe('useWorkflowExecution', () => {
  it('returns idle status when no execution is active', () => {
    const { result } = renderHook(() => useWorkflowExecution());

    expect(result.current.status).toBe('idle');
    expect(result.current.isCurrentExecution).toBe(false);
  });

  it('returns execution data when workflowId matches', () => {
    mockState.workflowId = 'wf-1';
    mockState.runId = 'run-1';
    mockState.status = 'running';
    mockState.nodeStates = { 'node-1': { status: 'running' } };

    const { result } = renderHook(() => useWorkflowExecution());

    expect(result.current.isCurrentExecution).toBe(true);
    expect(result.current.status).toBe('running');
    expect(result.current.runId).toBe('run-1');
  });

  it('returns idle when execution is for a different workflow', () => {
    mockState.workflowId = 'wf-other';
    mockState.runId = 'run-1';
    mockState.status = 'running';

    const { result } = renderHook(() => useWorkflowExecution());

    expect(result.current.isCurrentExecution).toBe(false);
    expect(result.current.status).toBe('idle');
  });

  it('accepts an explicit workflowId parameter', () => {
    mockState.workflowId = 'explicit-wf';
    mockState.status = 'completed';

    const { result } = renderHook(() => useWorkflowExecution('explicit-wf'));

    expect(result.current.isCurrentExecution).toBe(true);
    expect(result.current.status).toBe('completed');
  });

  it('provides action functions regardless of execution state', () => {
    const { result } = renderHook(() => useWorkflowExecution());

    expect(typeof result.current.startExecution).toBe('function');
    expect(typeof result.current.stopExecution).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });

  it('returns empty nodeStates when not current execution', () => {
    mockState.workflowId = 'wf-other';
    mockState.nodeStates = { 'node-1': { status: 'running' } };

    const { result } = renderHook(() => useWorkflowExecution());

    expect(result.current.isCurrentExecution).toBe(false);
    expect(Object.keys(result.current.nodeStates)).toHaveLength(0);
  });

  it('matches via runStatus.workflowId when storeWorkflowId is null', () => {
    mockState.workflowId = null;
    mockState.runStatus = { workflowId: 'wf-1' };
    mockState.status = 'completed';

    const { result } = renderHook(() => useWorkflowExecution());

    expect(result.current.isCurrentExecution).toBe(true);
    expect(result.current.status).toBe('completed');
  });
});
