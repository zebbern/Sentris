import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { cleanup, act } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/render-with-providers';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

const mockStartExecution = mock((_workflowId: string, _opts?: any) => Promise.resolve('run-123'));
const mockToast = mock((_params: any) => ({ id: 'test-toast' }));
const mockNavigate = mock((_path: string, _opts?: any) => {});
const mockFetchRuns = mock((_params: any) => Promise.resolve(undefined));
const mockMarkClean = mock(() => {});
const mockSetIsLoading = mock((_v: boolean) => {});
const mockResolveRuntimeInputDefinitions = mock(() => [] as { name: string; type: string }[]);
const mockResolveRuntimeInputDefaults = mock(() => ({}));
const mockSetNodes = mock((_fn: any) => {});

// Execution store mock
mock.module('@/store/executionStore', () => {
  const useExecutionStore = ((selector?: any) => {
    const state = {
      startExecution: mockStartExecution,
    };
    return selector ? selector(state) : state;
  }) as any;
  useExecutionStore.setState = () => {};
  useExecutionStore.getState = () => ({
    startExecution: mockStartExecution,
  });
  useExecutionStore.subscribe = () => () => {};
  useExecutionStore.destroy = () => {};
  return { useExecutionStore };
});

mock.module('@/store/executionTimelineStore', () => {
  const useExecutionTimelineStore = ((selector?: any) => {
    const state = {
      selectedRunId: null,
      playbackMode: 'live',
      isLiveFollowing: true,
      isPlaying: false,
    };
    return selector ? selector(state) : state;
  }) as any;
  useExecutionTimelineStore.setState = () => {};
  useExecutionTimelineStore.getState = () => ({
    selectedRunId: null,
    playbackMode: 'live',
    isLiveFollowing: true,
    isPlaying: false,
  });
  useExecutionTimelineStore.subscribe = () => () => {};
  useExecutionTimelineStore.destroy = () => {};
  return { useExecutionTimelineStore };
});

mock.module('@/services/api', () => ({
  api: {
    workflows: {
      commit: mock(() => Promise.resolve()),
    },
    executions: {
      getConfig: mock(() =>
        Promise.resolve({
          workflowId: 'wf-1',
          workflowVersionId: 'ver-1',
          workflowVersion: 1,
          inputs: { key: 'value' },
        }),
      ),
    },
  },
}));

mock.module('@/features/analytics/events', () => ({
  track: mock(() => {}),
  Events: {
    WorkflowRunStarted: 'workflow_run_started',
  },
}));

mock.module('@/lib/queryKeys', () => ({
  queryKeys: {
    workflows: {
      versions: (id: string) => ['workflows', id, 'versions'],
    },
  },
}));

mock.module('@/lib/logger', () => ({
  logger: {
    error: mock(() => {}),
    warn: mock(() => {}),
    info: mock(() => {}),
    debug: mock(() => {}),
  },
}));

// Import hook AFTER all mock.module() calls
import { useWorkflowRunner } from '@/features/workflow-builder/hooks/useWorkflowRunner';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const defaultOptions = {
  canManageWorkflows: true,
  metadata: {
    id: 'wf-1',
    name: 'Test Workflow',
    description: 'A test workflow',
    currentVersionId: 'ver-1',
    currentVersion: 1,
  },
  isDirty: false,
  isNewWorkflow: false,
  nodes: [{ id: 'n1', type: 'custom', position: { x: 0, y: 0 }, data: {} }] as any[],
  setNodes: mockSetNodes,
  toast: mockToast,
  resolveRuntimeInputDefinitions: mockResolveRuntimeInputDefinitions,
  resolveRuntimeInputDefaults: mockResolveRuntimeInputDefaults,
  fetchRuns: mockFetchRuns,
  markClean: mockMarkClean,
  navigate: mockNavigate,
  mostRecentRunId: null as string | null,
  setIsLoading: mockSetIsLoading,
};

function renderRunner(overrides: Partial<typeof defaultOptions> = {}) {
  return renderHookWithProviders(() => useWorkflowRunner({ ...defaultOptions, ...overrides }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockStartExecution.mockClear();
  mockStartExecution.mockImplementation(() => Promise.resolve('run-123'));
  mockToast.mockClear();
  mockNavigate.mockClear();
  mockFetchRuns.mockClear();
  mockFetchRuns.mockImplementation(() => Promise.resolve(undefined));
  mockMarkClean.mockClear();
  mockSetIsLoading.mockClear();
  mockResolveRuntimeInputDefinitions.mockClear();
  mockResolveRuntimeInputDefinitions.mockImplementation(() => []);
  mockResolveRuntimeInputDefaults.mockClear();
  mockResolveRuntimeInputDefaults.mockImplementation(() => ({}));
  mockSetNodes.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWorkflowRunner', () => {
  beforeEach(() => {
    cleanup();
    resetMocks();
  });

  afterEach(cleanup);

  // --- Initial state ---

  it('returns expected initial state', () => {
    const { result } = renderRunner();

    expect(result.current.runDialogOpen).toBe(false);
    expect(result.current.runtimeInputs).toEqual([]);
    expect(result.current.prefilledRuntimeValues).toEqual({});
    expect(result.current.pendingVersionId).toBeNull();
    expect(typeof result.current.handleRun).toBe('function');
    expect(typeof result.current.executeWorkflow).toBe('function');
    expect(typeof result.current.handleRerunFromTimeline).toBe('function');
  });

  // --- handleRun: permission check ---

  it('handleRun shows "Insufficient permissions" toast when user lacks admin role', async () => {
    const { result } = renderRunner({ canManageWorkflows: false });

    await act(async () => {
      await result.current.handleRun();
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    const toastCall = mockToast.mock.calls[0][0] as any;
    expect(toastCall.title).toBe('Insufficient permissions');
    expect(toastCall.variant).toBe('destructive');
  });

  // --- handleRun: empty nodes ---

  it('handleRun shows "Cannot run workflow" toast when nodes are empty', async () => {
    const { result } = renderRunner({ nodes: [] });

    await act(async () => {
      await result.current.handleRun();
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    const toastCall = mockToast.mock.calls[0][0] as any;
    expect(toastCall.title).toBe('Cannot run workflow');
  });

  // --- handleRun: new/unsaved workflow ---

  it('handleRun shows "Save workflow to run" toast when workflow is new', async () => {
    const { result } = renderRunner({ isNewWorkflow: true });

    await act(async () => {
      await result.current.handleRun();
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    const toastCall = mockToast.mock.calls[0][0] as any;
    expect(toastCall.title).toBe('Save workflow to run');
  });

  // --- handleRun: runtime inputs ---

  it('handleRun opens RunWorkflowDialog when runtime inputs exist', async () => {
    const runtimeDefs = [{ name: 'input1', type: 'string' }];
    mockResolveRuntimeInputDefinitions.mockReturnValue(runtimeDefs);
    mockResolveRuntimeInputDefaults.mockReturnValue({ input1: 'default' });

    const { result } = renderRunner();

    await act(async () => {
      await result.current.handleRun();
    });

    expect(result.current.runDialogOpen).toBe(true);
    expect(result.current.runtimeInputs).toEqual(runtimeDefs);
    expect(result.current.prefilledRuntimeValues).toEqual({ input1: 'default' });
  });

  // --- handleRun: no runtime inputs → executeWorkflow ---

  it('handleRun calls executeWorkflow directly when no runtime inputs', async () => {
    mockResolveRuntimeInputDefinitions.mockReturnValue([]);

    const { result } = renderRunner();

    await act(async () => {
      await result.current.handleRun();
    });

    expect(mockStartExecution).toHaveBeenCalledTimes(1);
  });

  // --- executeWorkflow: isDirty ---

  it('executeWorkflow shows "Save changes before running" warning when isDirty is true', async () => {
    const { result } = renderRunner({ isDirty: true });

    await act(async () => {
      await result.current.executeWorkflow();
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    const toastCall = mockToast.mock.calls[0][0] as any;
    expect(toastCall.title).toBe('Save changes before running');
    expect(toastCall.variant).toBe('warning');
    expect(mockStartExecution).not.toHaveBeenCalled();
  });

  // --- executeWorkflow: success ---

  it('executeWorkflow on success starts execution, tracks analytics, and navigates', async () => {
    const { result } = renderRunner();

    await act(async () => {
      await result.current.executeWorkflow();
    });

    expect(mockStartExecution).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const navPath = mockNavigate.mock.calls[0][0];
    expect(navPath).toContain('/workflows/wf-1/runs/run-123');
  });

  // --- executeWorkflow: API error ---

  it('executeWorkflow on API error shows destructive toast', async () => {
    mockStartExecution.mockRejectedValue(new Error('Execution failed'));

    const { result } = renderRunner();

    await act(async () => {
      await result.current.executeWorkflow();
    });

    expect(mockToast).toHaveBeenCalled();
    const lastCall = mockToast.mock.calls[mockToast.mock.calls.length - 1][0] as any;
    expect(lastCall.variant).toBe('destructive');
    expect(lastCall.title).toBe('Workflow Execution Failed');
  });

  // --- executeWorkflow: permission check ---

  it('executeWorkflow blocks when user lacks permissions', async () => {
    const { result } = renderRunner({ canManageWorkflows: false });

    await act(async () => {
      await result.current.executeWorkflow();
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    const toastCall = mockToast.mock.calls[0][0] as any;
    expect(toastCall.title).toBe('Insufficient permissions');
    expect(mockStartExecution).not.toHaveBeenCalled();
  });
});
