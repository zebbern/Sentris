// ---------------------------------------------------------------------------
// Barrel re-export — backward-compatible facade for executionStore consumers
// ---------------------------------------------------------------------------

export {
  useExecutionLifecycleStore,
  useExecutionLifecycleStore as useExecutionStore,
} from './executionLifecycleStore';
export { useTerminalStreamStore } from './terminalStreamStore';
export { useExecutionLogStore } from './executionLogStore';

// Types
export type {
  ExecutionLifecycle,
  TrackedRun,
  TerminalStreamChunk,
  TerminalStreamState,
} from './types';

// Helpers (useful for tests or advanced consumers)
export {
  mapStatusToLifecycle,
  mergeById,
  mergeEvents,
  mergeLogEntries,
  deriveNodeStates,
  terminalKey,
  MAX_TERMINAL_CHUNKS,
  MAX_TRACKED_RUNS,
} from './helpers';

// ---------------------------------------------------------------------------
// initializeExecutionStore — timeline scrubbing subscription
// ---------------------------------------------------------------------------

import { logger } from '@/lib/logger';
import { useExecutionLifecycleStore } from './executionLifecycleStore';
import { useExecutionLogStore } from './executionLogStore';

let timelineUnsubscribe: (() => void) | null = null;

export const initializeExecutionStore = () => {
  if (timelineUnsubscribe) {
    timelineUnsubscribe();
    timelineUnsubscribe = null;
  }

  void import('../executionTimelineStore')
    .then(({ useExecutionTimelineStore }) => {
      timelineUnsubscribe = useExecutionTimelineStore.subscribe(
        (state: { currentTime: number; playbackMode: string; selectedRunId: string | null }) => ({
          currentTime: state.currentTime,
          playbackMode: state.playbackMode,
          selectedRunId: state.selectedRunId,
        }),
        ({
          currentTime,
          playbackMode,
          selectedRunId,
        }: {
          currentTime: number;
          playbackMode: string;
          selectedRunId: string | null;
        }) => {
          if (playbackMode === 'replay' && selectedRunId) {
            const logState = useExecutionLogStore.getState();
            const lifecycleState = useExecutionLifecycleStore.getState();
            if (logState.logMode === 'scrubbing' && lifecycleState.runId === selectedRunId) {
              const bufferMs = 5000;
              const startTime = new Date(currentTime - bufferMs);
              const endTime = new Date(currentTime + bufferMs);
              void logState.fetchLogsForTimeRange(startTime, endTime, selectedRunId);
            }
          }
        },
      );
    })
    .catch((error: unknown) => {
      logger.error('Failed to initialize execution store timeline subscription', error);
    });
};
