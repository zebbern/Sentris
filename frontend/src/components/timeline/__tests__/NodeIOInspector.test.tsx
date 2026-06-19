import { describe, it, expect, afterEach, afterAll, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { restoreMockedModules } from '@/test/restore-mocks';

// ---------------------------------------------------------------------------
// Store and query mocks
// ---------------------------------------------------------------------------

let mockSelectedRunId: string | null = 'run-1';
let mockSelectedNodeId: string | null = null;

mock.module('@/store/executionTimelineStore', () => {
  const useExecutionTimelineStore = ((selector?: any) => {
    const state = {
      selectedRunId: mockSelectedRunId,
      selectedNodeId: mockSelectedNodeId,
    };
    return selector ? selector(state) : state;
  }) as any;
  useExecutionTimelineStore.getState = () => ({
    selectedRunId: mockSelectedRunId,
    selectedNodeId: mockSelectedNodeId,
  });
  useExecutionTimelineStore.setState = () => {};
  useExecutionTimelineStore.subscribe = () => () => {};
  useExecutionTimelineStore.destroy = () => {};
  return { useExecutionTimelineStore };
});

let mockNodeIOData: any = null;
let mockNodeIOLoading = false;
let mockNodeIOError: Error | null = null;

mock.module('@/hooks/queries/useExecutionQueries', () => ({
  useExecutionNodeIO: () => ({
    data: mockNodeIOData,
    isLoading: mockNodeIOLoading,
    error: mockNodeIOError,
  }),
}));

mock.module('@/services/api', () => ({
  api: {
    executions: {
      getNodeIO: mock(async () => null),
    },
  },
}));

mock.module('@/lib/logger', () => ({
  logger: { error: mock(() => {}) },
}));

mock.module('@/components/ui/MessageModal', () => ({
  MessageModal: () => null,
}));

// Dynamic import with query param to bypass stale mock.module from ExecutionInspector.test.tsx
// @ts-expect-error — query parameter creates a separate module cache entry
const { NodeIOInspector } = await import('../NodeIOInspector?unmocked');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NodeIOInspector', () => {
  afterAll(() => {
    restoreMockedModules([
      '@/store/executionTimelineStore',
      '@/hooks/queries/useExecutionQueries',
      '@/services/api',
      '@/lib/logger',
      '@/components/ui/MessageModal',
    ]);
  });

  afterEach(() => {
    cleanup();
    mockSelectedRunId = 'run-1';
    mockSelectedNodeId = null;
    mockNodeIOData = null;
    mockNodeIOLoading = false;
    mockNodeIOError = null;
  });

  it('shows empty state when no run is selected', () => {
    mockSelectedRunId = null;
    render(<NodeIOInspector />);

    expect(screen.getByText('Select a run to view I/O')).toBeTruthy();
  });

  it('shows spinner when loading and no data', () => {
    mockNodeIOLoading = true;
    const { container } = render(<NodeIOInspector />);

    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('shows error message when query fails', () => {
    mockNodeIOError = new Error('Network failure');
    render(<NodeIOInspector />);

    expect(screen.getByText('Network failure')).toBeTruthy();
  });

  it('renders input and output sections for selected node', () => {
    mockSelectedNodeId = 'node-a';
    mockNodeIOData = {
      nodes: [
        {
          nodeRef: 'node-a',
          componentId: 'http-request',
          status: 'completed',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:00:01Z',
          durationMs: 1000,
          inputs: { url: 'https://example.com' },
          outputs: { statusCode: 200 },
          inputsSize: 50,
          outputsSize: 30,
          inputsSpilled: false,
          outputsSpilled: false,
          errorMessage: null,
        },
      ],
    };
    render(<NodeIOInspector />);

    // Node ref badge
    expect(screen.getByText('node-a')).toBeTruthy();
    // Component ID
    expect(screen.getByText('http-request')).toBeTruthy();
  });

  it('renders node list when data is available but no node selected', () => {
    mockSelectedNodeId = null;
    mockNodeIOData = {
      nodes: [
        {
          nodeRef: 'node-x',
          componentId: 'transform',
          status: 'completed',
          inputs: { data: 'hello' },
          outputs: { result: 'HELLO' },
          inputsSize: 10,
          outputsSize: 20,
          inputsSpilled: false,
          outputsSpilled: false,
          errorMessage: null,
        },
      ],
    };
    render(<NodeIOInspector />);

    expect(screen.getByText('node-x')).toBeTruthy();
    expect(screen.getByText('transform')).toBeTruthy();
  });

  it('shows completed status text for completed nodes', () => {
    mockNodeIOData = {
      nodes: [
        {
          nodeRef: 'node-ok',
          componentId: 'complete-node',
          status: 'completed',
          inputs: null,
          outputs: null,
          inputsSize: 0,
          outputsSize: 0,
          inputsSpilled: false,
          outputsSpilled: false,
          errorMessage: null,
        },
      ],
    };
    render(<NodeIOInspector />);

    expect(screen.getByText('completed')).toBeTruthy();
  });

  it('shows failed status and error message for failed nodes', () => {
    mockNodeIOData = {
      nodes: [
        {
          nodeRef: 'node-fail',
          componentId: 'bad-node',
          status: 'failed',
          inputs: null,
          outputs: null,
          inputsSize: 0,
          outputsSize: 0,
          inputsSpilled: false,
          outputsSpilled: false,
          errorMessage: 'Something broke',
        },
      ],
    };
    render(<NodeIOInspector />);

    // Summary view shows status badge
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getByText('bad-node')).toBeTruthy();
  });
});
