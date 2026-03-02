// ---------------------------------------------------------------------------
// Barrel re-export — backward-compatible facade for executionTimelineStore
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { TERMINAL_STATUSES } from '@sentris/shared';
import { queryKeys } from '@/lib/queryKeys';
import { logger } from '@/lib/logger';
import type { TimelineStore, ExecutionStatusResponse } from './types';
import { calculateNodeStates, prepareTimelineEvents } from './helpers';
import { createNavigationSlice } from './timelineNavigationStore';
import { createEventSlice } from './timelineEventStore';
import { createPollingSlice } from './timelinePollingStore';

// Types
export type {
  TimelineEvent,
  NodeVisualState,
  DataPacket,
  RawDataPacket,
  AgentTimelineMarker,
  TimelineState,
  TimelineActions,
  TimelineStore,
} from './types';

// Helpers (useful for tests or advanced consumers)
export {
  prepareTimelineEvents,
  normalizeDataPackets,
  calculateNodeStates,
  PLAYBACK_SPEEDS,
  MIN_TIMELINE_DURATION_MS,
  INITIAL_STATE,
} from './helpers';

// ---------------------------------------------------------------------------
// Combined store — merges all slices into a single Zustand store
// ---------------------------------------------------------------------------

export const useExecutionTimelineStore = create<TimelineStore>()(
  subscribeWithSelector((...args) => ({
    ...createNavigationSlice(...args),
    ...createEventSlice(...args),
    ...createPollingSlice(...args),
  })),
);

// ---------------------------------------------------------------------------
// initializeTimelineStore — execution store subscription for live updates
// ---------------------------------------------------------------------------

let unsubscribeExecutionStore: (() => void) | null = null;

export const initializeTimelineStore = () => {
  if (unsubscribeExecutionStore) {
    unsubscribeExecutionStore();
    unsubscribeExecutionStore = null;
  }

  void import('../executionStore')
    .then(({ useExecutionStore }) => {
      // Track previous runStatus to detect completion
      let prevRunStatus: ExecutionStatusResponse | null = null;

      unsubscribeExecutionStore = useExecutionStore.subscribe((state) => {
        const { events: liveEvents, runId, status, runStatus } = state;
        const timelineStore = useExecutionTimelineStore.getState();

        // Check if workflow has completed or failed
        const isTerminalStatus =
          runStatus && (TERMINAL_STATUSES as readonly string[]).includes(runStatus.status);
        const isTerminalLifecycle = status === 'completed' || status === 'failed';

        // Check if status changed from non-terminal to terminal (workflow just completed)
        const statusJustChanged =
          prevRunStatus &&
          runStatus &&
          !(TERMINAL_STATUSES as readonly string[]).includes(prevRunStatus.status) &&
          (TERMINAL_STATUSES as readonly string[]).includes(runStatus.status);

        // Update prevRunStatus for next comparison
        prevRunStatus = runStatus;

        // If workflow is done and we're in live mode, switch to replay mode
        if (timelineStore.playbackMode === 'live' && timelineStore.selectedRunId === runId) {
          if (isTerminalStatus || isTerminalLifecycle || statusJustChanged) {
            // Workflow completed/failed - switch to replay mode
            if (!runId) return;

            // Update run in TanStack Query cache to mark it as completed
            if (runStatus) {
              void import('@/hooks/queries/useRunQueries').then(
                ({ getRunByIdFromCache, upsertRunInCache }) => {
                  const existingRun = getRunByIdFromCache(runId);
                  if (existingRun) {
                    const endTime =
                      runStatus.completedAt || runStatus.updatedAt || new Date().toISOString();
                    upsertRunInCache({
                      ...existingRun,
                      status: runStatus.status,
                      endTime,
                      duration: existingRun.startTime
                        ? new Date(endTime).getTime() - new Date(existingRun.startTime).getTime()
                        : existingRun.duration,
                      isLive: false,
                    });
                  }
                },
              );
            }

            // Invalidate execution-scoped queries for final fresh fetch
            import('@/lib/queryClient').then(({ queryClient: qc }) => {
              // Delay nodeIO invalidation to allow Kafka pipeline to deliver data
              // (100ms–2s typical latency for telemetry.node-io topic)
              setTimeout(() => {
                qc.invalidateQueries({
                  queryKey: queryKeys.executions.nodeIO(runId),
                });
              }, 3_000);
              // Second attempt in case Kafka was slow
              setTimeout(() => {
                qc.invalidateQueries({
                  queryKey: queryKeys.executions.nodeIO(runId),
                });
              }, 10_000);

              qc.invalidateQueries({
                queryKey: queryKeys.executions.result(runId),
              });
              qc.invalidateQueries({
                queryKey: queryKeys.executions.run(runId),
              });
            });

            useExecutionTimelineStore.setState({
              playbackMode: 'replay',
              isLiveFollowing: false,
              isPlaying: false,
            });
            // Reload timeline to get all final events, then position at end
            useExecutionTimelineStore
              .getState()
              .loadTimeline(runId)
              .then(() => {
                const finalState = useExecutionTimelineStore.getState();
                useExecutionTimelineStore.setState({
                  currentTime: finalState.totalDuration,
                  nodeStates: calculateNodeStates(
                    finalState.events,
                    finalState.dataFlows,
                    finalState.totalDuration,
                    finalState.timelineStartTime,
                  ),
                });
              });
            return;
          }

          // Continue updating timeline with new logs
          const workflowStartTime = runStatus?.startedAt
            ? new Date(runStatus.startedAt).getTime()
            : null;

          const {
            events: preparedEvents,
            totalDuration: eventDuration,
            timelineStartTime: calculatedStartTime,
          } = prepareTimelineEvents(liveEvents, workflowStartTime);

          const finalStartTime = workflowStartTime ?? calculatedStartTime;

          // Calculate clock offset once when we first get server time
          let clockOffset = useExecutionTimelineStore.getState().clockOffset;
          if (clockOffset === null && runStatus?.updatedAt) {
            const serverTime = new Date(runStatus.updatedAt).getTime();
            const clientTime = Date.now();
            clockOffset = serverTime - clientTime;
          }

          useExecutionTimelineStore.setState((state) => {
            const shouldFollow = state.isLiveFollowing;
            const nextCurrentTime = shouldFollow
              ? state.currentTime
              : Math.min(state.currentTime, eventDuration);

            return {
              events: preparedEvents,
              eventDuration,
              totalDuration: shouldFollow
                ? Math.max(state.totalDuration, eventDuration)
                : eventDuration,
              timelineStartTime: finalStartTime,
              clockOffset: clockOffset ?? state.clockOffset,
              currentTime: nextCurrentTime,
              nodeStates: calculateNodeStates(
                preparedEvents,
                state.dataFlows,
                nextCurrentTime,
                finalStartTime,
              ),
            };
          });
        }
      });
    })
    .catch((error: unknown) => {
      logger.error('Failed to initialize timeline store subscription', error);
    });
};
