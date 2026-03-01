import type { NodeStatus } from '@/schemas/node';
import type {
  TimelineEvent,
  TimelineState,
  DataPacket,
  RawDataPacket,
  NodeVisualState,
} from './types';
import type { ExecutionLog } from '@/schemas/execution';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLAYBACK_SPEEDS = [0.1, 0.5, 1, 2, 5, 10];

export const MIN_TIMELINE_DURATION_MS = 1;

export const INITIAL_STATE: TimelineState = {
  selectedRunId: null,
  events: [],
  dataFlows: [],
  totalDuration: 0,
  eventDuration: 0,
  timelineStartTime: null,
  clockOffset: null,
  currentTime: 0,
  playbackMode: 'replay',
  isPlaying: false,
  playbackSpeed: 1,
  isSeeking: false,
  nodeStates: {},
  selectedNodeId: null,
  selectedEventId: null,
  nodeSelectionHistory: {},
  showTimeline: true,
  showEventInspector: false,
  timelineZoom: 1,
  isLiveFollowing: false,
  agentMarkersRunId: null,
  agentMarkers: {},
};

// ---------------------------------------------------------------------------
// Pure helpers shared across timeline stores
// ---------------------------------------------------------------------------

export const prepareTimelineEvents = (
  rawEvents: ExecutionLog[],
  workflowStartTime?: number | null,
): {
  events: TimelineEvent[];
  totalDuration: number;
  timelineStartTime: number | null;
} => {
  if (!rawEvents || rawEvents.length === 0) {
    return {
      events: [],
      totalDuration: 0,
      timelineStartTime: workflowStartTime ?? null,
    };
  }

  const sortedEvents = [...rawEvents].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  if (sortedEvents.length === 0) {
    return {
      events: [],
      totalDuration: 0,
      timelineStartTime: workflowStartTime ?? 0,
    };
  }

  // Use workflow start time if provided, otherwise use first event timestamp
  // Always prefer workflowStartTime when available (it's the authoritative source)
  const firstEventTime = new Date(sortedEvents[0].timestamp).getTime();
  const startTime =
    workflowStartTime !== null && workflowStartTime !== undefined
      ? workflowStartTime
      : firstEventTime;
  const endTime = new Date(sortedEvents[sortedEvents.length - 1].timestamp).getTime();
  const totalDuration = Math.max(endTime - startTime, MIN_TIMELINE_DURATION_MS);

  const events: TimelineEvent[] = sortedEvents.map((event, index) => {
    const eventTime = new Date(event.timestamp).getTime();
    const offsetMs = eventTime - startTime;

    // Calculate duration based on next event or a default duration
    let duration = 0;
    if (index < sortedEvents.length - 1) {
      const nextEventTime = new Date(sortedEvents[index + 1].timestamp).getTime();
      duration = Math.max(nextEventTime - eventTime, 100); // Minimum 100ms duration
    } else {
      duration = Math.max(totalDuration - offsetMs, 100); // For last event, use remaining time
    }

    return {
      ...event,
      visualTime: totalDuration > 0 ? offsetMs / totalDuration : 0,
      duration,
      offsetMs,
    };
  });

  return {
    events,
    totalDuration,
    timelineStartTime: startTime,
  };
};

export const normalizeDataPackets = (
  rawPackets: RawDataPacket[] = [],
  timelineStartTime: number | null,
  totalDuration: number,
): DataPacket[] => {
  if (!rawPackets.length) {
    return [];
  }

  return rawPackets
    .filter(
      (
        packet,
      ): packet is RawDataPacket & {
        id: string;
        sourceNode: string;
        targetNode: string;
        timestamp: string;
      } => {
        return Boolean(packet.id && packet.sourceNode && packet.targetNode && packet.timestamp);
      },
    )
    .map((packet) => {
      const packetTimestamp = new Date(packet.timestamp).getTime();
      const baseStart = timelineStartTime ?? packetTimestamp;
      const computedTotal =
        totalDuration > 0 ? totalDuration : Math.max(packetTimestamp - baseStart, 1);

      const visualTime =
        typeof packet.visualTime === 'number'
          ? packet.visualTime
          : computedTotal > 0
            ? Math.max(0, Math.min(1, (packetTimestamp - baseStart) / computedTotal))
            : 0;

      return {
        id: packet.id,
        sourceNode: packet.sourceNode,
        targetNode: packet.targetNode,
        inputKey: packet.inputKey,
        payload: packet.payload,
        timestamp: packetTimestamp,
        size: typeof packet.size === 'number' ? packet.size : Number(packet.size ?? 0),
        type: (packet.type as DataPacket['type']) ?? 'json',
        visualTime,
      };
    });
};

export const calculateNodeStates = (
  events: TimelineEvent[],
  dataFlows: DataPacket[],
  currentTime: number,
  timelineStartTime?: number | null,
): Record<string, NodeVisualState> => {
  const states: Record<string, NodeVisualState> = {};

  if (events.length === 0) {
    return states;
  }

  const firstEventTimestamp = new Date(events[0].timestamp).getTime();
  const startTime = timelineStartTime ?? firstEventTimestamp;
  const absoluteCurrentTime = startTime + currentTime;
  const filteredPackets = dataFlows.filter((packet) => {
    const packetTime = new Date(packet.timestamp).getTime();
    return packetTime <= absoluteCurrentTime;
  });

  const inputPacketsByNode = new Map<string, DataPacket[]>();
  const outputPacketsByNode = new Map<string, DataPacket[]>();

  filteredPackets.forEach((packet) => {
    if (!inputPacketsByNode.has(packet.targetNode)) {
      inputPacketsByNode.set(packet.targetNode, []);
    }
    inputPacketsByNode.get(packet.targetNode)!.push(packet);

    if (!outputPacketsByNode.has(packet.sourceNode)) {
      outputPacketsByNode.set(packet.sourceNode, []);
    }
    outputPacketsByNode.get(packet.sourceNode)!.push(packet);
  });

  // Group events by node
  const nodeEvents = new Map<string, TimelineEvent[]>();
  events.forEach((event) => {
    if (event.nodeId) {
      if (!nodeEvents.has(event.nodeId)) {
        nodeEvents.set(event.nodeId, []);
      }
      nodeEvents.get(event.nodeId)!.push(event);
    }
  });

  // Calculate state for each node
  nodeEvents.forEach((nodeEventList, nodeId) => {
    const sortedEvents = [...nodeEventList].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const relevantEvents = sortedEvents.filter(
      (event) => new Date(event.timestamp).getTime() <= absoluteCurrentTime,
    );

    if (relevantEvents.length === 0) {
      states[nodeId] = {
        status: 'idle',
        progress: 0,
        startTime: new Date(sortedEvents[0].timestamp).getTime(),
        eventCount: 0,
        totalEvents: sortedEvents.length,
        lastEvent: null,
        dataFlow: { input: [], output: [] },
        lastMetadata: undefined,
        lastActivityId: undefined,
        attempts: 0,
        retryCount: 0,
      };
      return;
    }

    const lastEvent = relevantEvents[relevantEvents.length - 1];
    const firstNodeEventTimestamp = new Date(sortedEvents[0].timestamp).getTime();
    const lastEventTimestamp = new Date(lastEvent.timestamp).getTime();
    let highestAttempt = 0;
    let latestMetadata: TimelineEvent['metadata'] | undefined;
    let lastActivityId: string | undefined;

    relevantEvents.forEach((event) => {
      const attempt = typeof event.metadata?.attempt === 'number' ? event.metadata.attempt : null;
      if (attempt && attempt > highestAttempt) {
        highestAttempt = attempt;
      }
      if (event.metadata) {
        latestMetadata = event.metadata;
        if (typeof event.metadata.activityId === 'string') {
          lastActivityId = event.metadata.activityId;
        }
      }
    });

    const attempts =
      highestAttempt ||
      (typeof lastEvent.metadata?.attempt === 'number'
        ? lastEvent.metadata.attempt
        : relevantEvents.length > 0
          ? 1
          : 0);
    const retryCount = attempts > 0 ? Math.max(0, attempts - 1) : 0;

    // Determine status based on last event
    let status: NodeStatus = 'idle';
    let humanInputRequestId: string | undefined;

    switch (lastEvent.type) {
      case 'STARTED':
        status = 'running';
        break;
      case 'PROGRESS':
        status = 'running';
        break;
      case 'HTTP_REQUEST_SENT':
      case 'HTTP_RESPONSE_RECEIVED':
      case 'HTTP_REQUEST_ERROR':
        status = 'running';
        break;
      case 'AWAITING_INPUT':
        status = 'awaiting_input';
        if (lastEvent.data && typeof lastEvent.data.requestId === 'string') {
          humanInputRequestId = lastEvent.data.requestId;
        }
        break;
      case 'COMPLETED':
        status = 'success';
        break;
      case 'FAILED':
        status = 'error';
        break;
      case 'SKIPPED':
        status = 'skipped';
        break;
    }

    // Calculate progress based on events observed vs total events
    const completedEvents = relevantEvents.filter((e) => e.type === 'COMPLETED');
    const hasCompleted = completedEvents.length > 0;

    let progress = 0;
    if (hasCompleted) {
      progress = 100;
    } else if (sortedEvents.length > 0) {
      const eventRatio = relevantEvents.length / sortedEvents.length;
      progress = Math.min(100, Math.max(0, eventRatio * 100));
    } else {
      progress = 0;
    }

    states[nodeId] = {
      status,
      progress,
      startTime: firstNodeEventTimestamp,
      endTime: status === 'success' || status === 'error' ? lastEventTimestamp : undefined,
      eventCount: relevantEvents.length,
      totalEvents: sortedEvents.length,
      lastEvent,
      dataFlow: {
        input: inputPacketsByNode.get(nodeId) ?? [],
        output: outputPacketsByNode.get(nodeId) ?? [],
      },
      lastMetadata: latestMetadata ?? lastEvent.metadata,
      lastActivityId,
      humanInputRequestId,
      attempts,
      retryCount,
    };
  });

  // Ensure nodes that only appear in data flow packets are represented
  filteredPackets.forEach((packet) => {
    if (!states[packet.sourceNode]) {
      states[packet.sourceNode] = {
        status: 'idle',
        progress: 0,
        startTime: new Date(packet.timestamp).getTime(),
        eventCount: 0,
        totalEvents: 0,
        lastEvent: null,
        dataFlow: {
          input: inputPacketsByNode.get(packet.sourceNode) ?? [],
          output: outputPacketsByNode.get(packet.sourceNode) ?? [],
        },
        lastMetadata: undefined,
        lastActivityId: undefined,
        attempts: 0,
        retryCount: 0,
      };
    }
    if (!states[packet.targetNode]) {
      states[packet.targetNode] = {
        status: 'idle',
        progress: 0,
        startTime: new Date(packet.timestamp).getTime(),
        eventCount: 0,
        totalEvents: 0,
        lastEvent: null,
        dataFlow: {
          input: inputPacketsByNode.get(packet.targetNode) ?? [],
          output: outputPacketsByNode.get(packet.targetNode) ?? [],
        },
        lastMetadata: undefined,
        lastActivityId: undefined,
        attempts: 0,
        retryCount: 0,
      };
    }
  });

  return states;
};
