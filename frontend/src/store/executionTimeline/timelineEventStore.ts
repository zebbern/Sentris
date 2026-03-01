import type { StateCreator } from 'zustand';
import type {
  TimelineStore,
  TimelineEvent,
  DataPacket,
  RawDataPacket,
  NodeVisualState,
  AgentTimelineMarker,
  ExecutionLog,
} from './types';
import { prepareTimelineEvents, normalizeDataPackets, calculateNodeStates } from './helpers';

// ---------------------------------------------------------------------------
// Event slice — event/node/data-flow state management
// ---------------------------------------------------------------------------

export interface EventSlice {
  // State
  events: TimelineEvent[];
  dataFlows: DataPacket[];
  nodeStates: Record<string, NodeVisualState>;
  selectedNodeId: string | null;
  selectedEventId: string | null;
  nodeSelectionHistory: Record<string, string | null>;
  agentMarkersRunId: string | null;
  agentMarkers: Record<string, AgentTimelineMarker[]>;

  // Actions
  updateFromLiveEvent: (event: ExecutionLog) => void;
  appendDataFlows: (packets: RawDataPacket[]) => void;
  selectNode: (nodeId: string | null) => void;
  selectEvent: (eventId: string | null) => void;
  setAgentMarkers: (runId: string, nodeId: string, markers: AgentTimelineMarker[]) => void;
}

export const createEventSlice: StateCreator<TimelineStore, [], [], EventSlice> = (set, get) => ({
  // State
  events: [],
  dataFlows: [],
  nodeStates: {},
  selectedNodeId: null,
  selectedEventId: null,
  nodeSelectionHistory: {},
  agentMarkersRunId: null,
  agentMarkers: {},

  // Actions
  selectNode: (nodeId: string | null) => {
    const state = get();
    // Update selection and also save to history for the current run
    const updatedHistory = state.selectedRunId
      ? { ...state.nodeSelectionHistory, [state.selectedRunId]: nodeId }
      : state.nodeSelectionHistory;
    set({ selectedNodeId: nodeId, selectedEventId: null, nodeSelectionHistory: updatedHistory });
  },

  selectEvent: (eventId: string | null) => {
    set({ selectedEventId: eventId });
  },

  appendDataFlows: (packets: RawDataPacket[]) => {
    if (!packets || packets.length === 0) {
      return;
    }

    set((state) => {
      const derivedDuration =
        state.eventDuration > 0
          ? state.eventDuration
          : state.events.length > 0 && state.timelineStartTime !== null
            ? new Date(state.events[state.events.length - 1].timestamp).getTime() -
              state.timelineStartTime
            : 0;

      const normalized = normalizeDataPackets(packets, state.timelineStartTime, derivedDuration);
      const dataFlows = [...state.dataFlows, ...normalized];
      return {
        dataFlows,
        nodeStates: calculateNodeStates(
          state.events,
          dataFlows,
          state.currentTime,
          state.timelineStartTime,
        ),
      };
    });
  },

  updateFromLiveEvent: (event: ExecutionLog) => {
    const { events, playbackMode, timelineStartTime: currentStartTime } = get();
    if (playbackMode !== 'live') return;

    if (events.some((existing) => existing.id === event.id)) {
      return;
    }

    const combinedEvents = [...events, event];
    // Preserve existing timelineStartTime if already set correctly (from workflow start time)
    const {
      events: preparedEvents,
      totalDuration,
      timelineStartTime: calculatedStartTime,
    } = prepareTimelineEvents(combinedEvents, currentStartTime);

    set((state) => {
      const resolvedStart = calculatedStartTime;
      const nextTotal = Math.max(totalDuration, state.totalDuration);
      const shouldFollow = state.isLiveFollowing;
      const nextCurrent = shouldFollow ? nextTotal : Math.min(state.currentTime, nextTotal);

      // Calculate clock offset if not already set (only once per run)
      let clockOffset = state.clockOffset;
      if (clockOffset === null) {
        const eventServerTime = new Date(event.timestamp).getTime();
        const clientTime = Date.now();
        clockOffset = eventServerTime - clientTime;
      }

      const presentationCurrent = shouldFollow ? state.currentTime : nextCurrent;
      return {
        events: preparedEvents,
        eventDuration: nextTotal,
        totalDuration: shouldFollow ? Math.max(state.totalDuration, nextTotal) : nextTotal,
        timelineStartTime: resolvedStart,
        clockOffset,
        currentTime: presentationCurrent,
        nodeStates: calculateNodeStates(
          preparedEvents,
          state.dataFlows,
          presentationCurrent,
          resolvedStart,
        ),
      };
    });
  },

  setAgentMarkers: (runId: string, nodeId: string, markers: AgentTimelineMarker[]) => {
    set((state) => {
      const sameRun = state.agentMarkersRunId === runId;
      const currentMarkers = sameRun ? (state.agentMarkers[nodeId] ?? []) : [];
      const isEqual =
        sameRun &&
        currentMarkers.length === markers.length &&
        currentMarkers.every((marker, index) => {
          const next = markers[index];
          return (
            marker.id === next?.id &&
            marker.nodeId === next?.nodeId &&
            marker.label === next?.label &&
            marker.timestamp === next?.timestamp
          );
        });
      if (isEqual) {
        return state;
      }
      let nextBase = sameRun ? { ...state.agentMarkers } : {};
      if (markers.length > 0) {
        nextBase[nodeId] = markers;
      } else {
        const { [nodeId]: _removed, ...rest } = nextBase;
        nextBase = rest;
      }
      return {
        agentMarkersRunId: runId,
        agentMarkers: nextBase,
      };
    });
  },
});
