import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { realModuleExports } from '@/test/restore-mocks';

// Override any bled mock.module with the real store
mock.module('@/store/executionStore', () => realModuleExports('@/store/executionStore'));

import { useExecutionLifecycleStore } from '../executionLifecycleStore';
import { useExecutionLogStore } from '../executionLogStore';
import { useTerminalStreamStore } from '../terminalStreamStore';

// ---------------------------------------------------------------------------
// We test the store's synchronous state management (initial state, tracked
// runs, reset, delegation). Async methods (startExecution, pollOnce etc.)
// depend on external API calls and EventSource, which are tested via
// sseHandlers and integration tests.
// ---------------------------------------------------------------------------

describe('executionLifecycleStore', () => {
  beforeEach(() => {
    useExecutionLifecycleStore.getState().reset();
  });

  // --- Initial state ---

  it('initializes with idle status and no run', () => {
    const state = useExecutionLifecycleStore.getState();
    expect(state.runId).toBeNull();
    expect(state.workflowId).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.runStatus).toBeNull();
    expect(state.events).toEqual([]);
    expect(state.nodeStates).toEqual({});
    expect(state.cursor).toBeNull();
    expect(state.pollingInterval).toBeNull();
    expect(state.eventSource).toBeNull();
    expect(state.streamingMode).toBe('none');
    expect(state.trackedRuns).toEqual([]);
  });

  // --- Tracked runs ---

  it('addTrackedRun adds a new tracked run', () => {
    useExecutionLifecycleStore.setState({ status: 'running' });
    useExecutionLifecycleStore.getState().addTrackedRun({
      runId: 'run-1',
      workflowId: 'wf-1',
      workflowName: 'Test Workflow',
    });
    const runs = useExecutionLifecycleStore.getState().trackedRuns;
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe('run-1');
    expect(runs[0].workflowId).toBe('wf-1');
    expect(runs[0].workflowName).toBe('Test Workflow');
    expect(runs[0].status).toBe('running');
  });

  it('addTrackedRun updates existing run instead of duplicating', () => {
    useExecutionLifecycleStore.setState({ status: 'running' });
    useExecutionLifecycleStore.getState().addTrackedRun({
      runId: 'run-1',
      workflowId: 'wf-1',
    });
    useExecutionLifecycleStore.setState({ status: 'completed' });
    useExecutionLifecycleStore.getState().addTrackedRun({
      runId: 'run-1',
      workflowId: 'wf-1',
      workflowName: 'Updated Name',
    });
    const runs = useExecutionLifecycleStore.getState().trackedRuns;
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].workflowName).toBe('Updated Name');
  });

  it('addTrackedRun limits to MAX_TRACKED_RUNS (10)', () => {
    useExecutionLifecycleStore.setState({ status: 'running' });
    for (let i = 0; i < 12; i++) {
      useExecutionLifecycleStore.getState().addTrackedRun({
        runId: `run-${i}`,
        workflowId: 'wf-1',
      });
    }
    const runs = useExecutionLifecycleStore.getState().trackedRuns;
    expect(runs).toHaveLength(10);
    // Should keep the most recent 10
    expect(runs[0].runId).toBe('run-2');
    expect(runs[9].runId).toBe('run-11');
  });

  it('addTrackedRun defaults status to running when idle', () => {
    useExecutionLifecycleStore.setState({ status: 'idle' });
    useExecutionLifecycleStore.getState().addTrackedRun({
      runId: 'run-1',
      workflowId: 'wf-1',
    });
    const runs = useExecutionLifecycleStore.getState().trackedRuns;
    expect(runs[0].status).toBe('running');
  });

  it('removeTrackedRun removes a run by id', () => {
    useExecutionLifecycleStore.setState({ status: 'running' });
    useExecutionLifecycleStore.getState().addTrackedRun({ runId: 'run-1', workflowId: 'wf-1' });
    useExecutionLifecycleStore.getState().addTrackedRun({ runId: 'run-2', workflowId: 'wf-1' });
    useExecutionLifecycleStore.getState().removeTrackedRun('run-1');
    const runs = useExecutionLifecycleStore.getState().trackedRuns;
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe('run-2');
  });

  it('removeTrackedRun no-op for unknown run', () => {
    useExecutionLifecycleStore.setState({ status: 'running' });
    useExecutionLifecycleStore.getState().addTrackedRun({ runId: 'run-1', workflowId: 'wf-1' });
    useExecutionLifecycleStore.getState().removeTrackedRun('unknown');
    expect(useExecutionLifecycleStore.getState().trackedRuns).toHaveLength(1);
  });

  // --- Delegation ---

  it('getNodeLogs delegates to executionLogStore', () => {
    useExecutionLogStore.getState().mergeLiveLogs([
      {
        id: 'l1',
        runId: 'r1',
        nodeId: 'n1',
        type: 'PROGRESS',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'test',
      } as any,
    ]);
    const logs = useExecutionLifecycleStore.getState().getNodeLogs('n1');
    expect(logs).toHaveLength(1);
  });

  it('getNodeLogCounts delegates to executionLogStore', () => {
    useExecutionLogStore.getState().mergeLiveLogs([
      {
        id: 'l1',
        runId: 'r1',
        nodeId: 'n1',
        type: 'PROGRESS',
        level: 'error',
        timestamp: new Date().toISOString(),
        message: 'err',
      } as any,
    ]);
    const counts = useExecutionLifecycleStore.getState().getNodeLogCounts('n1');
    expect(counts.total).toBe(1);
    expect(counts.errors).toBe(1);
  });

  it('getLastLogMessage delegates to executionLogStore', () => {
    useExecutionLogStore.getState().mergeLiveLogs([
      {
        id: 'l1',
        runId: 'r1',
        nodeId: 'n1',
        type: 'PROGRESS',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'hello',
      } as any,
    ]);
    expect(useExecutionLifecycleStore.getState().getLastLogMessage('n1')).toBe('hello');
  });

  it('setLogMode delegates to executionLogStore', () => {
    useExecutionLifecycleStore.getState().setLogMode('historical');
    expect(useExecutionLogStore.getState().logMode).toBe('historical');
  });

  it('getDisplayLogs delegates to executionLogStore', () => {
    useExecutionLogStore.getState().mergeLiveLogs([
      {
        id: 'l1',
        runId: 'r1',
        nodeId: 'n1',
        type: 'PROGRESS',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'x',
      } as any,
    ]);
    const display = useExecutionLifecycleStore.getState().getDisplayLogs();
    expect(display).toHaveLength(1);
  });

  it('getTerminalSession delegates to terminalStreamStore', () => {
    useTerminalStreamStore.getState().mergeStreamChunks([
      {
        nodeRef: 'n1',
        stream: 'pty',
        chunkIndex: 1,
        payload: 'test',
        recordedAt: new Date().toISOString(),
      },
    ]);
    const session = useExecutionLifecycleStore.getState().getTerminalSession('n1', 'pty');
    expect(session).toBeDefined();
    expect(session!.chunks).toHaveLength(1);
  });

  // --- reset ---

  it('reset clears state and child stores', () => {
    // Populate some state
    useExecutionLifecycleStore.setState({
      runId: 'run-1',
      status: 'running',
      events: [{ id: 'e1' }] as any,
    });
    useExecutionLogStore.getState().mergeLiveLogs([
      {
        id: 'l1',
        runId: 'r1',
        nodeId: 'n1',
        type: 'PROGRESS',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'x',
      } as any,
    ]);
    useTerminalStreamStore.getState().mergeStreamChunks([
      {
        nodeRef: 'n1',
        stream: 'pty',
        chunkIndex: 1,
        payload: 'data',
        recordedAt: new Date().toISOString(),
      },
    ]);

    useExecutionLifecycleStore.getState().reset();

    expect(useExecutionLifecycleStore.getState().runId).toBeNull();
    expect(useExecutionLifecycleStore.getState().status).toBe('idle');
    expect(useExecutionLifecycleStore.getState().events).toEqual([]);
    expect(useExecutionLogStore.getState().liveLogs).toEqual([]);
    expect(useTerminalStreamStore.getState().terminalStreams).toEqual({});
  });

  // --- stopPolling ---

  it('stopPolling clears polling interval', () => {
    const interval = setInterval(() => {}, 1000);
    useExecutionLifecycleStore.setState({ pollingInterval: interval });
    useExecutionLifecycleStore.getState().stopPolling();
    expect(useExecutionLifecycleStore.getState().pollingInterval).toBeNull();
    clearInterval(interval); // cleanup
  });
});
