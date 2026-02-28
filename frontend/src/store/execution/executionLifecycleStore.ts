import { create } from 'zustand';
import { TERMINAL_STATUSES } from '@shipsec/shared';
import { api } from '@/services/api';
import { queryClient } from '@/lib/queryClient';
import { logger } from '@/lib/logger';
import { executionStatusOptions, executionTraceOptions } from '@/lib/executionQueryOptions';
import { invalidateRunsForWorkflow } from '@/hooks/queries/useRunQueries';
import { type ExecutionLog, type ExecutionStatusResponse } from '@/schemas/execution';
import type { NodeStatus } from '@/schemas/node';
import type { ExecutionLifecycle, TrackedRun } from './types';
import { MAX_TRACKED_RUNS, mapStatusToLifecycle, mergeEvents, deriveNodeStates } from './helpers';
import { useTerminalStreamStore } from './terminalStreamStore';
import { useExecutionLogStore } from './executionLogStore';
import { attachSSEHandlers } from './sseHandlers';

// ---------------------------------------------------------------------------
// State & Actions
// ---------------------------------------------------------------------------

interface ExecutionLifecycleStoreState {
  runId: string | null;
  workflowId: string | null;
  status: ExecutionLifecycle;
  runStatus: ExecutionStatusResponse | null;
  events: ExecutionLog[];
  nodeStates: Record<string, NodeStatus>;
  cursor: string | null;
  pollingInterval: NodeJS.Timeout | null;
  eventSource: EventSource | null;
  streamingMode: 'realtime' | 'polling' | 'none' | 'connecting';
  trackedRuns: TrackedRun[];
}

interface ExecutionLifecycleStoreActions {
  startExecution: (
    workflowId: string,
    options?: {
      inputs?: Record<string, unknown>;
      versionId?: string;
      version?: number;
    },
  ) => Promise<string | undefined>;
  stopExecution: () => Promise<void>;
  monitorRun: (runId: string, workflowId?: string | null) => void;
  pollOnce: () => Promise<void>;
  stopPolling: () => void;
  reset: () => void;
  connectStream: (runId: string) => Promise<void>;
  disconnectStream: () => void;
  // Log delegation (backward compat)
  getNodeLogs: (nodeId: string) => ExecutionLog[];
  getNodeLogCounts: (nodeId: string) => { total: number; errors: number; warnings: number };
  getLastLogMessage: (nodeId: string) => string | null;
  fetchLogsForTimeRange: (startTime: Date, endTime: Date) => Promise<void>;
  fetchHistoricalLogs: (runId: string) => Promise<void>;
  setLogMode: (mode: 'live' | 'scrubbing' | 'historical') => void;
  getDisplayLogs: () => ExecutionLog[];
  // Terminal delegation (backward compat)
  prefetchTerminal: (
    nodeId: string,
    stream?: 'pty' | 'stdout' | 'stderr',
    runIdOverride?: string | null,
  ) => Promise<void>;
  getTerminalSession: (
    nodeId: string,
    stream?: 'pty' | 'stdout' | 'stderr',
  ) => import('./types').TerminalStreamState | undefined;
  // Tracked runs
  addTrackedRun: (run: { runId: string; workflowId: string; workflowName?: string }) => void;
  removeTrackedRun: (runId: string) => void;
  switchToRun: (runId: string) => void;
}

type ExecutionLifecycleStore = ExecutionLifecycleStoreState & ExecutionLifecycleStoreActions;

const INITIAL_STATE: ExecutionLifecycleStoreState = {
  runId: null,
  workflowId: null,
  status: 'idle',
  runStatus: null,
  events: [],
  nodeStates: {},
  cursor: null,
  pollingInterval: null,
  eventSource: null,
  streamingMode: 'none',
  trackedRuns: [],
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useExecutionLifecycleStore = create<ExecutionLifecycleStore>((set, get) => ({
  ...INITIAL_STATE,

  startExecution: async (workflowId, options) => {
    try {
      const currentRunId = get().runId;
      if (currentRunId) {
        get().stopPolling();
      }

      set({
        status: 'queued',
        workflowId,
        events: [],
        nodeStates: {},
        cursor: null,
      });
      useExecutionLogStore.getState().resetLogs();
      useTerminalStreamStore.getState().resetTerminalStreams();

      const { executionId } = await api.executions.start(workflowId, options);
      if (!executionId) {
        set({ status: 'failed' });
        return undefined;
      }

      set({ runId: executionId, status: 'running' });
      get().addTrackedRun({ runId: executionId, workflowId });
      invalidateRunsForWorkflow(workflowId);

      await get().pollOnce();
      get().monitorRun(executionId, workflowId);
      return executionId;
    } catch (error: unknown) {
      logger.error('Failed to start execution:', error);
      set({ status: 'failed' });
      throw error;
    }
  },

  stopExecution: async () => {
    const runId = get().runId;
    if (!runId) return;

    try {
      await api.executions.cancel(runId);
      try {
        const statusPayload = await queryClient.fetchQuery(executionStatusOptions(runId));
        if (statusPayload) {
          const status = (statusPayload as ExecutionStatusResponse).status;
          const lifecycle = mapStatusToLifecycle(status);
          set({
            runStatus: statusPayload as ExecutionStatusResponse,
            status: lifecycle,
          });
        } else {
          set({ status: 'cancelled' });
        }
      } catch (statusError: unknown) {
        logger.warn('Failed to fetch final status after stop:', statusError);
        set({ status: 'cancelled' });
      }

      get().stopPolling();
      const workflowId = get().workflowId;
      if (workflowId) {
        invalidateRunsForWorkflow(workflowId);
      }
    } catch (error: unknown) {
      logger.error('Failed to stop execution:', error);
      get().stopPolling();
      set({ status: 'cancelled' });
    }
  },

  monitorRun: (runId, workflowId) => {
    if (!runId) return;

    const existingInterval = get().pollingInterval;
    if (existingInterval) clearInterval(existingInterval);
    if (workflowId) set({ workflowId });

    get().addTrackedRun({
      runId,
      workflowId: workflowId ?? get().workflowId ?? '',
    });

    let isFirstTick = true;
    const poll = async () => {
      if (isFirstTick) {
        isFirstTick = false;
        return;
      }
      await get().pollOnce();
    };

    const interval = setInterval(poll, 2000);
    set({ pollingInterval: interval, runId });

    get()
      .connectStream(runId)
      .catch((error: unknown) => {
        logger.error('[ExecutionStore] Failed to connect stream in monitorRun:', error);
      });
  },

  pollOnce: async () => {
    const runId = get().runId;
    if (!runId) return;

    try {
      const [statusPayload, traceEnvelope] = await Promise.all([
        queryClient.fetchQuery(executionStatusOptions(runId)),
        queryClient.fetchQuery(executionTraceOptions(runId)),
      ]);

      if (get().runId !== runId) return;
      if (!statusPayload || !traceEnvelope) {
        throw new Error('Failed to fetch execution data');
      }

      const rawEvents = (traceEnvelope.events || []) as Record<string, unknown>[];
      const validEvents = rawEvents.filter(
        (e): e is ExecutionLog =>
          typeof e === 'object' &&
          e !== null &&
          typeof e.id === 'string' &&
          typeof e.runId === 'string' &&
          typeof e.nodeId === 'string' &&
          typeof e.timestamp === 'string',
      );

      set((state) => {
        if (state.runId !== runId) return state;
        const mergedEvents = mergeEvents(state.events, validEvents);
        const nodeStates = deriveNodeStates(mergedEvents);
        const status = (statusPayload as ExecutionStatusResponse).status;
        const lifecycle = mapStatusToLifecycle(status);

        return {
          runStatus: statusPayload as ExecutionStatusResponse,
          status: lifecycle,
          events: mergedEvents,
          nodeStates,
          cursor: traceEnvelope.cursor ?? state.cursor,
          trackedRuns: state.trackedRuns.map((r) =>
            r.runId === runId ? { ...r, status: lifecycle } : r,
          ),
        };
      });

      const status = (statusPayload as ExecutionStatusResponse).status;
      if (status && TERMINAL_STATUSES.includes(status)) {
        get().stopPolling();
        const currentWorkflowId = get().workflowId;
        if (currentWorkflowId) {
          invalidateRunsForWorkflow(currentWorkflowId);
        }
      }
    } catch (error: unknown) {
      logger.error('Failed to poll execution status:', error);
    }
  },

  stopPolling: () => {
    const interval = get().pollingInterval;
    if (interval) {
      clearInterval(interval);
      set({ pollingInterval: null });
    }
    get().disconnectStream();
  },

  reset: () => {
    const interval = get().pollingInterval;
    if (interval) clearInterval(interval);
    get().disconnectStream();
    set({ ...INITIAL_STATE, streamingMode: 'none', trackedRuns: [] });
    useTerminalStreamStore.getState().resetTerminalStreams();
    useExecutionLogStore.getState().resetLogs();
  },

  connectStream: async (runId) => {
    if (typeof EventSource === 'undefined') return;

    const { cursor } = get();
    const { terminalCursor } = useTerminalStreamStore.getState();
    const { logCursor } = useExecutionLogStore.getState();
    get().disconnectStream();

    try {
      const streamParams: Record<string, string> = {};
      if (cursor) streamParams.cursor = cursor;
      if (terminalCursor) streamParams.terminalCursor = terminalCursor;
      if (logCursor) streamParams.logCursor = logCursor;

      const source = await api.executions.stream(
        runId,
        Object.keys(streamParams).length ? streamParams : undefined,
      );

      attachSSEHandlers(source, { set, get }, runId);
      set({ eventSource: source, streamingMode: 'connecting' });
    } catch (error: unknown) {
      logger.error('Failed to open execution stream', error);
    }
  },

  disconnectStream: () => {
    const existing = get().eventSource;
    if (existing) existing.close();
    set({ eventSource: null, streamingMode: 'none' });
  },

  // Delegation — terminal (backward compat)
  prefetchTerminal: async (nodeId, stream = 'pty', runIdOverride) => {
    const runId = runIdOverride ?? get().runId;
    await useTerminalStreamStore.getState().prefetchTerminal(nodeId, stream, runId);
  },

  getTerminalSession: (nodeId, stream = 'pty') =>
    useTerminalStreamStore.getState().getTerminalSession(nodeId, stream),

  // Delegation — logs (backward compat)
  getNodeLogs: (nodeId) => useExecutionLogStore.getState().getNodeLogs(nodeId),

  getNodeLogCounts: (nodeId) => useExecutionLogStore.getState().getNodeLogCounts(nodeId),

  getLastLogMessage: (nodeId) => useExecutionLogStore.getState().getLastLogMessage(nodeId),

  fetchLogsForTimeRange: async (startTime, endTime) => {
    const runId = get().runId;
    if (!runId) return;
    await useExecutionLogStore.getState().fetchLogsForTimeRange(startTime, endTime, runId);
  },

  fetchHistoricalLogs: async (runId) => {
    set({ runId });
    await useExecutionLogStore.getState().fetchHistoricalLogs(runId);
  },

  setLogMode: (mode) => useExecutionLogStore.getState().setLogMode(mode),

  getDisplayLogs: () => useExecutionLogStore.getState().getDisplayLogs(),

  // Tracked runs
  addTrackedRun: ({ runId, workflowId, workflowName }) => {
    set((state) => {
      const existing = state.trackedRuns.find((r) => r.runId === runId);
      if (existing) {
        return {
          trackedRuns: state.trackedRuns.map((r) =>
            r.runId === runId
              ? { ...r, status: state.status, workflowName: workflowName ?? r.workflowName }
              : r,
          ),
        };
      }

      const newRun: TrackedRun = {
        runId,
        workflowId,
        workflowName,
        status: state.status === 'idle' ? 'running' : state.status,
        startedAt: new Date().toISOString(),
      };
      const runs = [...state.trackedRuns, newRun];
      return { trackedRuns: runs.slice(-MAX_TRACKED_RUNS) };
    });
  },

  removeTrackedRun: (runId) => {
    set((state) => ({
      trackedRuns: state.trackedRuns.filter((r) => r.runId !== runId),
    }));
  },

  switchToRun: (runId) => {
    const tracked = get().trackedRuns.find((r) => r.runId === runId);
    if (!tracked) return;
    get().monitorRun(runId, tracked.workflowId);
  },
}));
