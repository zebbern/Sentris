import { TERMINAL_STATUSES } from '@shipsec/shared';
import { logger } from '@/lib/logger';
import {
  ExecutionStatusResponseSchema,
  type ExecutionLog,
  type ExecutionStatusResponse,
} from '@/schemas/execution';
import type { NodeStatus } from '@/schemas/node';
import type { ExecutionLifecycle, TrackedRun, TerminalStreamChunk } from './types';
import { mapStatusToLifecycle, mergeEvents, deriveNodeStates } from './helpers';
import { useTerminalStreamStore } from './terminalStreamStore';
import { useExecutionLogStore } from './executionLogStore';

// ---------------------------------------------------------------------------
// Types for the store accessor that SSE handlers need
// ---------------------------------------------------------------------------

interface SSEStoreAccessor {
  set: (
    partial:
      | Partial<{
          events: ExecutionLog[];
          nodeStates: Record<string, NodeStatus>;
          cursor: string | null;
          runStatus: ExecutionStatusResponse;
          status: ExecutionLifecycle;
          workflowId: string | null;
          trackedRuns: TrackedRun[];
          streamingMode: 'realtime' | 'polling' | 'none' | 'connecting';
          pollingInterval: NodeJS.Timeout | null;
          eventSource: EventSource | null;
        }>
      | ((state: {
          events: ExecutionLog[];
          nodeStates: Record<string, NodeStatus>;
          cursor: string | null;
          workflowId: string | null;
          trackedRuns: TrackedRun[];
          runStatus: ExecutionStatusResponse | null;
          pollingInterval: NodeJS.Timeout | null;
        }) => Partial<{
          events: ExecutionLog[];
          nodeStates: Record<string, NodeStatus>;
          cursor: string | null;
          runStatus: ExecutionStatusResponse;
          status: ExecutionLifecycle;
          workflowId: string | null;
          trackedRuns: TrackedRun[];
          streamingMode: 'realtime' | 'polling' | 'none' | 'connecting';
          pollingInterval: NodeJS.Timeout | null;
        }>),
  ) => void;
  get: () => {
    runStatus: ExecutionStatusResponse | null;
    pollingInterval: NodeJS.Timeout | null;
    stopPolling: () => void;
    pollOnce: () => Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// SSE event handler factories
// ---------------------------------------------------------------------------

export const createTraceHandler =
  ({ set }: SSEStoreAccessor) =>
  (event: Event) => {
    try {
      const payload = JSON.parse((event as MessageEvent).data) as {
        events?: ExecutionLog[];
        cursor?: string;
      };
      if (!payload.events || payload.events.length === 0) return;

      set((state) => {
        const mergedEvents = mergeEvents(state.events, payload.events as ExecutionLog[]);
        const nodeStates = deriveNodeStates(mergedEvents);
        const nextCursor =
          payload.cursor ?? payload.events![payload.events!.length - 1]?.id ?? state.cursor;
        return { events: mergedEvents, nodeStates, cursor: nextCursor ?? null };
      });
    } catch (error: unknown) {
      logger.error('Failed to parse trace payload from stream', error);
    }
  };

export const createStatusHandler =
  ({ set, get }: SSEStoreAccessor, runId: string) =>
  (event: Event) => {
    try {
      const statusPayload = ExecutionStatusResponseSchema.parse(
        JSON.parse((event as MessageEvent).data) as unknown,
      );
      set((state) => {
        const lifecycle = mapStatusToLifecycle(statusPayload.status);
        return {
          runStatus: statusPayload,
          status: lifecycle,
          workflowId: state.workflowId ?? statusPayload.workflowId,
          trackedRuns: state.trackedRuns.map((r) =>
            r.runId === runId ? { ...r, status: lifecycle } : r,
          ),
        };
      });
      if (TERMINAL_STATUSES.includes(statusPayload.status)) {
        get().stopPolling();
      }
    } catch (error: unknown) {
      logger.error('Failed to parse status update from stream', error);
    }
  };

export const createDataflowHandler = () => async (event: Event) => {
  try {
    const payload = JSON.parse((event as MessageEvent).data) as {
      packets?: import('../executionTimelineStore').RawDataPacket[];
    };
    if (!payload.packets || payload.packets.length === 0) return;
    const { useExecutionTimelineStore } = await import('../executionTimelineStore');
    useExecutionTimelineStore.getState().appendDataFlows(payload.packets);
  } catch (error: unknown) {
    logger.error('Failed to parse dataflow payload from stream', error);
  }
};

export const createTerminalHandler = () => (event: Event) => {
  try {
    const payload = JSON.parse((event as MessageEvent).data) as {
      cursor?: string | null;
      chunks?: TerminalStreamChunk[];
    };
    if (!payload.chunks || payload.chunks.length === 0) return;
    useTerminalStreamStore.getState().mergeStreamChunks(payload.chunks, payload.cursor);
  } catch (error: unknown) {
    logger.error(
      'Failed to parse terminal payload from stream',
      error,
      (event as MessageEvent).data,
    );
  }
};

export const createLogsHandler = () => (event: Event) => {
  try {
    const payload = JSON.parse((event as MessageEvent).data) as {
      logs?: {
        id: string;
        runId: string;
        nodeId: string;
        level: ExecutionLog['level'];
        message: string;
        timestamp: string;
      }[];
      cursor?: string;
    };
    if (!payload.logs || payload.logs.length === 0) return;

    const newLogs: ExecutionLog[] = payload.logs.map((log) => ({
      id: log.id,
      runId: log.runId,
      nodeId: log.nodeId,
      type: 'PROGRESS' as const,
      level: log.level,
      timestamp: log.timestamp,
      message: log.message,
    }));
    useExecutionLogStore.getState().mergeLiveLogs(newLogs, payload.cursor);
  } catch (error: unknown) {
    logger.error('Failed to parse logs payload from stream', error, (event as MessageEvent).data);
  }
};

export const createReadyHandler =
  ({ set, get }: SSEStoreAccessor) =>
  (event: Event) => {
    try {
      const payload = JSON.parse((event as MessageEvent).data) as {
        mode: 'realtime' | 'polling';
        runId: string;
        interval?: number;
      };
      set({ streamingMode: payload.mode });

      if (payload.mode === 'realtime' && get().pollingInterval) {
        const existingInterval = get().pollingInterval;
        if (existingInterval) clearInterval(existingInterval);
        const backupPoll = setInterval(async () => {
          const state = get();
          if (state.runStatus && TERMINAL_STATUSES.includes(state.runStatus.status)) return;
          await get().pollOnce();
        }, 5000);
        set({ pollingInterval: backupPoll });
      }
    } catch (error: unknown) {
      logger.error('Failed to parse ready event from stream', error);
    }
  };

/**
 * Attach all SSE event listeners to the given EventSource.
 * Returns the source with all handlers wired up.
 */
export const attachSSEHandlers = (
  source: EventSource,
  accessor: SSEStoreAccessor,
  runId: string,
): void => {
  source.addEventListener('trace', createTraceHandler(accessor));
  source.addEventListener('status', createStatusHandler(accessor, runId));
  source.addEventListener('dataflow', createDataflowHandler());
  source.addEventListener('terminal', createTerminalHandler());
  source.addEventListener('logs', createLogsHandler());
  source.addEventListener('ready', createReadyHandler(accessor));
  source.addEventListener('complete', () => accessor.get().stopPolling());

  source.onerror = (event) => {
    logger.warn('Execution stream error', event);
    source.close();
    accessor.set({ eventSource: null, streamingMode: 'none' });
  };
};
