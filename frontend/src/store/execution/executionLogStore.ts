import { create } from 'zustand';
import { api } from '@/services/api';
import { logger } from '@/lib/logger';
import type { ExecutionLog } from '@/schemas/execution';
import { mergeLogEntries } from './helpers';

// ---------------------------------------------------------------------------
// State & Actions
// ---------------------------------------------------------------------------

interface ExecutionLogStoreState {
  liveLogs: ExecutionLog[];
  historicalLogs: ExecutionLog[];
  scrubberLogs: ExecutionLog[];
  logMode: 'live' | 'scrubbing' | 'historical';
  logCursor: string | null;
}

interface ExecutionLogStoreActions {
  /** Return logs for a specific node, filtered from the current display set. */
  getNodeLogs: (nodeId: string) => ExecutionLog[];
  /** Return count summary for a specific node's logs. */
  getNodeLogCounts: (nodeId: string) => { total: number; errors: number; warnings: number };
  /** Return the last log message for a node, or null. */
  getLastLogMessage: (nodeId: string) => string | null;
  /** Fetch logs for a time range (timeline scrubbing). */
  fetchLogsForTimeRange: (startTime: Date, endTime: Date, runId: string) => Promise<void>;
  /** Fetch all historical logs for a completed run. */
  fetchHistoricalLogs: (runId: string) => Promise<void>;
  /** Switch the active log display mode. */
  setLogMode: (mode: 'live' | 'scrubbing' | 'historical') => void;
  /** Return the log array for the current display mode. */
  getDisplayLogs: () => ExecutionLog[];
  /** Merge incoming live logs from SSE. */
  mergeLiveLogs: (logs: ExecutionLog[], cursor?: string | null) => void;
  /** Reset all log state. */
  resetLogs: () => void;
}

type ExecutionLogStore = ExecutionLogStoreState & ExecutionLogStoreActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_LOG_STATE: ExecutionLogStoreState = {
  liveLogs: [],
  historicalLogs: [],
  scrubberLogs: [],
  logMode: 'live',
  logCursor: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useExecutionLogStore = create<ExecutionLogStore>((set, get) => ({
  ...INITIAL_LOG_STATE,

  getNodeLogs: (nodeId: string) => {
    const logs = get().getDisplayLogs();
    return logs.filter((log) => log.nodeId === nodeId);
  },

  getNodeLogCounts: (nodeId: string) => {
    const nodeLogs = get().getNodeLogs(nodeId);
    return {
      total: nodeLogs.length,
      errors: nodeLogs.filter((log) => log.level === 'error').length,
      warnings: nodeLogs.filter((log) => log.level === 'warn').length,
    };
  },

  getLastLogMessage: (nodeId: string) => {
    const nodeLogs = get().getNodeLogs(nodeId);
    if (nodeLogs.length === 0) return null;

    const lastLog = nodeLogs[nodeLogs.length - 1];
    return lastLog.message || lastLog.error?.message || `${lastLog.type}`;
  },

  fetchLogsForTimeRange: async (startTime: Date, endTime: Date, runId: string) => {
    if (!runId) return;

    try {
      const result = await api.executions.getLogs(runId, {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        limit: 200,
      });

      set(() => ({
        scrubberLogs: result.logs as ExecutionLog[],
        logMode: 'scrubbing',
      }));
    } catch (error: unknown) {
      logger.error('Failed to fetch logs for time range', error);
    }
  },

  fetchHistoricalLogs: async (runId: string) => {
    try {
      const result = await api.executions.getLogs(runId, {
        limit: 500,
      });

      set(() => ({
        historicalLogs: result.logs as ExecutionLog[],
        logMode: 'historical',
      }));
    } catch (error: unknown) {
      logger.error('Failed to fetch historical logs', error);
    }
  },

  setLogMode: (mode: 'live' | 'scrubbing' | 'historical') => {
    set({ logMode: mode });
  },

  getDisplayLogs: () => {
    const state = get();
    switch (state.logMode) {
      case 'live':
        return state.liveLogs;
      case 'scrubbing':
        return state.scrubberLogs;
      case 'historical':
        return state.historicalLogs;
      default:
        return state.liveLogs;
    }
  },

  mergeLiveLogs: (logs: ExecutionLog[], cursor?: string | null) => {
    if (logs.length === 0) return;

    set((state) => ({
      liveLogs: mergeLogEntries(state.liveLogs, logs),
      logCursor: cursor ?? state.logCursor,
    }));
  },

  resetLogs: () => {
    set(INITIAL_LOG_STATE);
  },
}));
