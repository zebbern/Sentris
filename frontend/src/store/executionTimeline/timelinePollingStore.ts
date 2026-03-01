import type { StateCreator } from 'zustand';
import type { TimelineStore, ExecutionStatusResponse } from './types';
import { queryClient } from '@/lib/queryClient';
import { logger } from '@/lib/logger';
import {
  executionEventsOptions,
  executionDataFlowsOptions,
  executionStatusOptions,
} from '@/lib/executionQueryOptions';
import type { ExecutionLog } from '@/schemas/execution';
import {
  INITIAL_STATE,
  prepareTimelineEvents,
  normalizeDataPackets,
  calculateNodeStates,
} from './helpers';

// ---------------------------------------------------------------------------
// Polling slice — run selection, timeline loading, live mode, reset
// ---------------------------------------------------------------------------

// Module-level mutable state for live tick throttling
let liveTickTimestamp: number | null = null;

export interface PollingSlice {
  // State
  selectedRunId: string | null;
  totalDuration: number;
  eventDuration: number;
  timelineStartTime: number | null;
  clockOffset: number | null;
  playbackMode: 'live' | 'replay';
  isLiveFollowing: boolean;

  // Actions
  selectRun: (runId: string, initialMode?: 'live' | 'replay') => Promise<void>;
  loadTimeline: (runId: string) => Promise<void>;
  switchToLiveMode: () => void;
  goLive: () => void;
  tickLiveClock: () => void;
  reset: () => void;
}

export const createPollingSlice: StateCreator<TimelineStore, [], [], PollingSlice> = (
  set,
  get,
) => ({
  // State
  selectedRunId: null,
  totalDuration: 0,
  eventDuration: 0,
  timelineStartTime: null,
  clockOffset: null,
  playbackMode: 'replay',
  isLiveFollowing: false,

  // Actions
  selectRun: async (runId: string, initialMode: 'live' | 'replay' = 'replay') => {
    const state = get();

    // Idempotent: skip if already selected with same mode
    if (state.selectedRunId === runId && state.playbackMode === initialMode) {
      return;
    }

    const previousRunId = state.selectedRunId;

    // Save current node selection to history before switching runs
    const updatedHistory = { ...state.nodeSelectionHistory };
    if (previousRunId && previousRunId !== runId) {
      updatedHistory[previousRunId] = state.selectedNodeId;
    }

    // When switching to a different run, check if we have a saved selection for it
    const restoredNodeId =
      previousRunId !== runId ? (updatedHistory[runId] ?? null) : state.selectedNodeId;

    // Clear previous events before loading new timeline
    set({
      selectedRunId: runId,
      events: [],
      dataFlows: [],
      totalDuration: 0,
      eventDuration: 0,
      currentTime: 0,
      timelineStartTime: null,
      clockOffset: null,
      nodeStates: {},
      playbackMode: initialMode,
      isPlaying: false,
      isLiveFollowing: initialMode === 'live',
      agentMarkersRunId: null,
      agentMarkers: {},
      nodeSelectionHistory: updatedHistory,
      selectedNodeId: restoredNodeId,
    });
    await get().loadTimeline(runId);
  },

  loadTimeline: async (runId: string) => {
    try {
      const [eventsResponse, dataFlowResponse, statusResponse] = await Promise.all([
        queryClient.fetchQuery(executionEventsOptions(runId)),
        queryClient.fetchQuery(executionDataFlowsOptions(runId)),
        queryClient.fetchQuery(executionStatusOptions(runId)).catch(() => null),
      ]);

      // Only fetch historical logs when we're in replay mode (live runs rely on SSE live logs)
      if (get().playbackMode !== 'live') {
        void import('../executionStore').then(({ useExecutionStore }) => {
          useExecutionStore.getState().fetchHistoricalLogs(runId);
        });
      }

      const eventsList = ((eventsResponse.events as unknown as ExecutionLog[]) ?? []).filter(
        (event): event is ExecutionLog =>
          Boolean(
            event.id && event.runId && event.nodeId && event.timestamp && event.type && event.level,
          ),
      );

      // Use run start time if available, otherwise fallback to first event
      const status = statusResponse as ExecutionStatusResponse | null;
      const parsedStartTime = status?.startedAt ? new Date(status.startedAt).getTime() : NaN;
      const workflowStartTime = !isNaN(parsedStartTime) ? parsedStartTime : null;

      const {
        events,
        totalDuration: eventDuration,
        timelineStartTime,
      } = prepareTimelineEvents(eventsList, workflowStartTime);
      const packetsList = (dataFlowResponse.packets ?? []).map((packet) => {
        let timestamp: string;
        if (typeof packet.timestamp === 'number') {
          timestamp = new Date(packet.timestamp).toISOString();
        } else if (typeof packet.timestamp === 'string') {
          timestamp = packet.timestamp;
        } else {
          timestamp = new Date().toISOString();
        }
        return {
          id: packet.id ?? '',
          sourceNode: packet.sourceNode ?? '',
          targetNode: packet.targetNode ?? '',
          timestamp,
          inputKey: packet.inputKey ?? undefined,
          payload: packet.payload ?? undefined,
          size: packet.size,
          type: packet.type,
          visualTime: packet.visualTime,
        };
      });
      const dataFlows = normalizeDataPackets(packetsList, timelineStartTime, eventDuration);

      const state = get();
      const isLiveMode = state.playbackMode === 'live';
      const hadTimeline = state.events.length > 0;
      // In replay mode we want the transcript/timeline to start at the end for fresh loads
      const initialCurrentTime = isLiveMode
        ? state.isLiveFollowing
          ? eventDuration
          : Math.min(state.currentTime, eventDuration)
        : hadTimeline
          ? Math.min(state.currentTime, eventDuration)
          : eventDuration;

      set({
        events,
        dataFlows,
        eventDuration,
        totalDuration: eventDuration,
        currentTime: initialCurrentTime,
        timelineStartTime,
        clockOffset: null,
        nodeStates: calculateNodeStates(events, dataFlows, initialCurrentTime, timelineStartTime),
      });
    } catch (error: unknown) {
      logger.error('Failed to load timeline:', error);
    }
  },

  goLive: () => {
    const state = get();
    if (!state.selectedRunId) return;
    const liveBaseline = Math.max(state.totalDuration, state.eventDuration);
    set({
      playbackMode: 'live',
      isLiveFollowing: true,
      currentTime: liveBaseline,
      totalDuration: liveBaseline,
    });
  },

  tickLiveClock: () => {
    const state = get();
    if (state.playbackMode !== 'live' || !state.timelineStartTime) {
      return;
    }
    const now = Date.now();
    if (liveTickTimestamp && now - liveTickTimestamp < 200) {
      return;
    }
    liveTickTimestamp = now;

    // Use clock offset to calculate server time
    let serverNow: number;
    if (state.clockOffset !== null) {
      serverNow = now + state.clockOffset;
    } else if (state.events.length > 0) {
      const lastEvent = state.events[state.events.length - 1];
      serverNow = new Date(lastEvent.timestamp).getTime();
    } else {
      serverNow = now;
    }

    const elapsed = Math.max(0, serverNow - state.timelineStartTime);
    const projectedDuration = Math.max(elapsed, state.eventDuration);
    const shouldAdvance = state.isLiveFollowing;
    const nextCurrent = shouldAdvance ? projectedDuration : state.currentTime;

    if (projectedDuration === state.totalDuration && nextCurrent === state.currentTime) {
      return;
    }
    set({
      totalDuration: projectedDuration,
      currentTime: nextCurrent,
    });
  },

  switchToLiveMode: () => {
    const state = get();
    if (!state.selectedRunId) return;

    const liveBaseline = Math.max(state.totalDuration, state.eventDuration);
    set({
      playbackMode: 'live',
      currentTime: liveBaseline,
      totalDuration: liveBaseline,
      isPlaying: false,
      isLiveFollowing: true,
    });

    get().loadTimeline(state.selectedRunId);
  },

  reset: () => {
    set(INITIAL_STATE);
  },
});
