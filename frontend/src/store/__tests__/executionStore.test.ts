import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { realModuleExports } from '@/test/restore-mocks';

// Override any bled mock.module with the real store
mock.module('@/store/executionStore', () => realModuleExports('@/store/executionStore'));

// Mock EventSource for streaming tests
class MockEventSource {
  static events: Record<string, ((event: MessageEvent) => void)[]> = {};
  url: string;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    this.readyState = 1; // OPEN
  }

  addEventListener(event: string, callback: (event: MessageEvent) => void) {
    if (!MockEventSource.events[event]) {
      MockEventSource.events[event] = [];
    }
    MockEventSource.events[event].push(callback);
  }

  removeEventListener(event: string, callback: (event: MessageEvent) => void) {
    if (MockEventSource.events[event]) {
      MockEventSource.events[event] = MockEventSource.events[event].filter((cb) => cb !== callback);
    }
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  // Helper for testing
  static dispatchEvent(event: string, data: any) {
    const callbacks = MockEventSource.events[event] || [];
    callbacks.forEach((callback) => {
      callback({ data: JSON.stringify(data) } as MessageEvent);
    });
  }

  static reset() {
    MockEventSource.events = {};
  }
}

// Store original EventSource
const originalEventSource = global.EventSource;

const mockExecutions = {
  start: mock(),
  getStatus: mock(),
  getTrace: mock(),
  cancel: mock(),
  stream: mock(),
  listRuns: mock(async () => ({ runs: [] })),
};

mock.module('@/services/api', () => ({
  api: {
    executions: {
      ...mockExecutions,
      stream: mock(async (runId: string, _options?: any) => {
        return new MockEventSource(`/api/workflows/runs/${runId}/stream`);
      }),
    },
  },
}));

// Mock authStore so queryKeys.getOrgScope() works in CI where Zustand stores
// may not initialize properly
mock.module('@/store/authStore', () => ({
  useAuthStore: Object.assign(
    mock(() => ({})),
    {
      getState: mock(() => ({ organizationId: 'test-org' })),
      subscribe: mock(() => () => {}),
      setState: mock(),
    },
  ),
}));

// Mock executionQueryOptions to avoid queryKeys → authStore dependency chain
mock.module('@/lib/executionQueryOptions', () => ({
  executionStatusOptions: (runId: string) => ({
    queryKey: ['executions', 'status', runId],
    queryFn: () => mockExecutions.getStatus(),
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  }),
  executionTraceOptions: (runId: string) => ({
    queryKey: ['executions', 'trace', runId],
    queryFn: () => mockExecutions.getTrace(),
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  }),
  executionTerminalChunksOptions: (runId: string, nodeRef: string, stream: string) => ({
    queryKey: ['executions', 'terminalChunks', runId, nodeRef, stream],
    queryFn: mock(),
    staleTime: 10_000,
    gcTime: 30_000,
  }),
}));

// Mock queryClient so fetchQuery calls the queryFn from our mocked options
mock.module('@/lib/queryClient', () => ({
  queryClient: {
    fetchQuery: mock(async (options: { queryFn: () => Promise<any> }) => {
      return options.queryFn();
    }),
    getQueryData: mock(() => undefined),
    setQueryData: mock(),
    invalidateQueries: mock(),
    prefetchQuery: mock(),
  },
}));

// Mock invalidateRunsForWorkflow to avoid unrelated side effects
mock.module('@/hooks/queries/useRunQueries', () => ({
  invalidateRunsForWorkflow: mock(),
  upsertRunInCache: mock(),
  fetchMoreRuns: mock(),
  getRunByIdFromCache: mock(() => null),
}));

import { useExecutionStore } from '../executionStore';
import type { ExecutionLog, ExecutionStatusResponse } from '@/schemas/execution';

const baseStatus = (overrides: Partial<ExecutionStatusResponse> = {}): ExecutionStatusResponse => ({
  runId: 'run-1',
  workflowId: 'wf-1',
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  taskQueue: 'sentris-default',
  historyLength: 0,
  ...overrides,
});

const event = (overrides: Partial<ExecutionLog> = {}): ExecutionLog => ({
  id: overrides.id ?? Math.random().toString(16).slice(2),
  runId: 'run-1',
  nodeId: 'node-1',
  type: 'STARTED',
  level: 'info',
  timestamp: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  useExecutionStore.getState().reset();
  mock.clearAllMocks();
  MockEventSource.reset();

  // Mock EventSource globally
  global.EventSource = MockEventSource as any;
});

afterEach(() => {
  // Restore original EventSource
  global.EventSource = originalEventSource;
});

describe('useExecutionStore', () => {
  it('merges new trace events without duplicating existing ones', async () => {
    const initialEvent = event({ id: '1', type: 'STARTED' });
    useExecutionStore.setState({
      runId: 'run-1',
      workflowId: 'wf-1',
      status: 'running',
      events: [initialEvent],
    });

    mockExecutions.getStatus.mockResolvedValue(baseStatus());
    mockExecutions.getTrace.mockResolvedValue({
      runId: 'run-1',
      cursor: '2',
      events: [initialEvent, event({ id: '2', type: 'COMPLETED', nodeId: 'node-1' })],
    });

    await useExecutionStore.getState().pollOnce();

    const { events, nodeStates } = useExecutionStore.getState();
    expect(events).toHaveLength(2);
    expect(nodeStates['node-1']).toBe('success');
  });

  it('stops polling when execution reaches a terminal status', async () => {
    const interval = setInterval(() => {}, 1000);
    useExecutionStore.setState({
      runId: 'run-1',
      pollingInterval: interval,
    });

    mockExecutions.getStatus.mockResolvedValue(baseStatus({ status: 'FAILED' }));
    mockExecutions.getTrace.mockResolvedValue({
      runId: 'run-1',
      cursor: '1',
      events: [event({ id: '1', type: 'FAILED' })],
    });

    await useExecutionStore.getState().pollOnce();

    expect(useExecutionStore.getState().pollingInterval).toBeNull();
    expect(useExecutionStore.getState().status).toBe('failed');
  });

  describe('Streaming functionality', () => {
    it('connects to streaming endpoint and handles ready event', async () => {
      const { connectStream } = useExecutionStore.getState();

      await connectStream('test-run-id');

      expect(useExecutionStore.getState().streamingMode).toBe('connecting');
      expect(useExecutionStore.getState().eventSource).toBeInstanceOf(MockEventSource);

      // Simulate ready event for realtime mode
      MockEventSource.dispatchEvent('ready', {
        mode: 'realtime',
        runId: 'test-run-id',
      });

      expect(useExecutionStore.getState().streamingMode).toBe('realtime');
    });

    it('handles incoming trace events from stream', async () => {
      const { connectStream } = useExecutionStore.getState();

      await connectStream('test-run-id');

      const newEvents = [
        event({ id: '1', type: 'STARTED', nodeId: 'node-1' }),
        event({ id: '2', type: 'PROGRESS', nodeId: 'node-1', message: 'Processing...' }),
      ];

      MockEventSource.dispatchEvent('trace', {
        events: newEvents,
        cursor: '2',
      });

      const { events, nodeStates } = useExecutionStore.getState();
      expect(events).toHaveLength(2);
      expect(nodeStates['node-1']).toBe('running');
      expect(events[1].message).toBe('Processing...');
    });

    it('handles status updates from stream', async () => {
      const { connectStream } = useExecutionStore.getState();

      await connectStream('test-run-id');

      MockEventSource.dispatchEvent('status', baseStatus({ status: 'COMPLETED' }));

      const { status, runStatus } = useExecutionStore.getState();
      expect(status).toBe('completed');
      expect(runStatus?.status).toBe('COMPLETED');
    });

    it('handles completion event and stops polling', async () => {
      const interval = setInterval(() => {}, 1000);
      useExecutionStore.setState({
        runId: 'test-run-id',
        pollingInterval: interval,
      });

      const { connectStream } = useExecutionStore.getState();
      await connectStream('test-run-id');

      MockEventSource.dispatchEvent('complete', { runId: 'test-run-id', status: 'COMPLETED' });

      // Should stop both polling and streaming
      expect(useExecutionStore.getState().pollingInterval).toBeNull();
      expect(useExecutionStore.getState().eventSource).toBeNull();
    });

    it('handles streaming errors gracefully', async () => {
      const { connectStream } = useExecutionStore.getState();

      await connectStream('test-run-id');

      // Simulate error event
      const mockEventSource = useExecutionStore.getState().eventSource as MockEventSource;
      mockEventSource.readyState = 3; // ERROR state

      // Trigger onerror by setting onerror and calling it
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Event('error'));
      }

      expect(useExecutionStore.getState().eventSource).toBeNull();
      expect(useExecutionStore.getState().streamingMode).toBe('none');
    });

    it('disconnects stream properly', async () => {
      const { connectStream, disconnectStream } = useExecutionStore.getState();

      await connectStream('test-run-id');
      expect(useExecutionStore.getState().eventSource).toBeInstanceOf(MockEventSource);

      disconnectStream();

      expect(useExecutionStore.getState().eventSource).toBeNull();
      expect(useExecutionStore.getState().streamingMode).toBe('none');
    });

    it('falls back to polling mode when realtime is not available', async () => {
      const { connectStream } = useExecutionStore.getState();

      await connectStream('test-run-id');

      // Simulate ready event for polling mode
      MockEventSource.dispatchEvent('ready', {
        mode: 'polling',
        runId: 'test-run-id',
        interval: 1000,
      });

      expect(useExecutionStore.getState().streamingMode).toBe('polling');
    });
  });

  describe('Tracked runs', () => {
    it('addTrackedRun adds a run to trackedRuns', () => {
      useExecutionStore.getState().addTrackedRun({
        runId: 'run-1',
        workflowId: 'wf-1',
        workflowName: 'Test Workflow',
      });

      const { trackedRuns } = useExecutionStore.getState();
      expect(trackedRuns).toHaveLength(1);
      expect(trackedRuns[0].runId).toBe('run-1');
      expect(trackedRuns[0].workflowId).toBe('wf-1');
      expect(trackedRuns[0].workflowName).toBe('Test Workflow');
    });

    it('addTrackedRun updates existing run instead of duplicating', () => {
      useExecutionStore.getState().addTrackedRun({
        runId: 'run-1',
        workflowId: 'wf-1',
        workflowName: 'Original Name',
      });

      useExecutionStore.getState().addTrackedRun({
        runId: 'run-1',
        workflowId: 'wf-1',
        workflowName: 'Updated Name',
      });

      const { trackedRuns } = useExecutionStore.getState();
      expect(trackedRuns).toHaveLength(1);
      expect(trackedRuns[0].workflowName).toBe('Updated Name');
    });

    it('addTrackedRun enforces MAX_TRACKED_RUNS limit (FIFO)', () => {
      // Add 11 runs — the limit is 10
      for (let i = 0; i < 11; i++) {
        useExecutionStore.getState().addTrackedRun({
          runId: `run-${i}`,
          workflowId: 'wf-1',
        });
      }

      const { trackedRuns } = useExecutionStore.getState();
      expect(trackedRuns).toHaveLength(10);
      // First run should have been pruned
      expect(trackedRuns[0].runId).toBe('run-1');
      expect(trackedRuns[9].runId).toBe('run-10');
    });

    it('removeTrackedRun removes a run by id', () => {
      useExecutionStore.getState().addTrackedRun({
        runId: 'run-1',
        workflowId: 'wf-1',
      });
      useExecutionStore.getState().addTrackedRun({
        runId: 'run-2',
        workflowId: 'wf-1',
      });

      useExecutionStore.getState().removeTrackedRun('run-1');

      const { trackedRuns } = useExecutionStore.getState();
      expect(trackedRuns).toHaveLength(1);
      expect(trackedRuns[0].runId).toBe('run-2');
    });

    it('removeTrackedRun is a no-op for unknown id', () => {
      useExecutionStore.getState().addTrackedRun({
        runId: 'run-1',
        workflowId: 'wf-1',
      });

      useExecutionStore.getState().removeTrackedRun('run-unknown');

      expect(useExecutionStore.getState().trackedRuns).toHaveLength(1);
    });

    it('reset clears all tracked runs', () => {
      useExecutionStore.getState().addTrackedRun({
        runId: 'run-1',
        workflowId: 'wf-1',
      });

      useExecutionStore.getState().reset();

      expect(useExecutionStore.getState().trackedRuns).toHaveLength(0);
    });
  });

  describe('monitorRun', () => {
    it('sets runId when monitoring a run', () => {
      useExecutionStore.getState().monitorRun('run-123', 'wf-1');

      expect(useExecutionStore.getState().runId).toBe('run-123');
    });

    it('sets workflowId when provided', () => {
      useExecutionStore.getState().monitorRun('run-123', 'wf-42');

      expect(useExecutionStore.getState().workflowId).toBe('wf-42');
    });

    it('auto-tracks the monitored run in trackedRuns', () => {
      useExecutionStore.getState().monitorRun('run-123', 'wf-1');

      const { trackedRuns } = useExecutionStore.getState();
      expect(trackedRuns).toHaveLength(1);
      expect(trackedRuns[0].runId).toBe('run-123');
      expect(trackedRuns[0].workflowId).toBe('wf-1');
    });

    it('does not clear other tracked runs when monitoring a new run', () => {
      useExecutionStore.getState().addTrackedRun({
        runId: 'existing-run',
        workflowId: 'wf-1',
        workflowName: 'Existing',
      });

      useExecutionStore.getState().monitorRun('new-run', 'wf-2');

      const { trackedRuns } = useExecutionStore.getState();
      expect(trackedRuns).toHaveLength(2);
      expect(trackedRuns.find((r) => r.runId === 'existing-run')).toBeTruthy();
      expect(trackedRuns.find((r) => r.runId === 'new-run')).toBeTruthy();
    });

    it('is a no-op when runId is empty', () => {
      useExecutionStore.getState().monitorRun('', 'wf-1');

      expect(useExecutionStore.getState().runId).toBeNull();
      expect(useExecutionStore.getState().trackedRuns).toHaveLength(0);
    });

    it('clears existing polling interval before starting new one', () => {
      const existingInterval = setInterval(() => {}, 1000);
      useExecutionStore.setState({ pollingInterval: existingInterval });

      useExecutionStore.getState().monitorRun('run-1', 'wf-1');

      // The old interval should have been cleared and a new one set
      const { pollingInterval } = useExecutionStore.getState();
      expect(pollingInterval).not.toBeNull();
      expect(pollingInterval).not.toBe(existingInterval);

      // Cleanup
      if (pollingInterval) clearInterval(pollingInterval);
    });
  });

  describe('switchToRun', () => {
    it('switches active runId to the specified tracked run', () => {
      useExecutionStore.getState().addTrackedRun({
        runId: 'run-1',
        workflowId: 'wf-1',
      });
      useExecutionStore.getState().addTrackedRun({
        runId: 'run-2',
        workflowId: 'wf-2',
      });

      useExecutionStore.getState().switchToRun('run-2');

      expect(useExecutionStore.getState().runId).toBe('run-2');
    });

    it('is a no-op when runId is not in trackedRuns', () => {
      useExecutionStore.getState().addTrackedRun({
        runId: 'run-1',
        workflowId: 'wf-1',
      });
      useExecutionStore.setState({ runId: 'run-1' });

      useExecutionStore.getState().switchToRun('run-unknown');

      expect(useExecutionStore.getState().runId).toBe('run-1');
    });
  });
});
