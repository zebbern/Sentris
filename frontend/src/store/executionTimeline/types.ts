import type { ExecutionLog, ExecutionStatusResponse } from '@/schemas/execution';
import type { NodeStatus } from '@/schemas/node';

// ---------------------------------------------------------------------------
// Shared types for the execution timeline store family
// ---------------------------------------------------------------------------

// Types for the visual timeline system
export interface TimelineEvent extends ExecutionLog {
  visualTime: number; // Normalized time for playback (0-1)
  duration?: number; // Event duration in ms
  offsetMs: number; // Milliseconds from first event timestamp
}

export interface NodeVisualState {
  status: NodeStatus;
  progress: number; // 0-100
  startTime: number;
  endTime?: number;
  eventCount: number;
  totalEvents: number;
  lastEvent: TimelineEvent | null;
  dataFlow: {
    input: DataPacket[];
    output: DataPacket[];
  };
  lastMetadata?: TimelineEvent['metadata'];
  lastActivityId?: string;
  humanInputRequestId?: string;
  attempts: number;
  retryCount: number;
}

export interface DataPacket {
  id: string;
  sourceNode: string;
  targetNode: string;
  inputKey?: string;
  payload: unknown;
  timestamp: number;
  size: number; // bytes
  type: 'file' | 'json' | 'text' | 'binary';
  visualTime: number; // When this packet should appear in timeline
}

export interface RawDataPacket {
  id: string;
  sourceNode: string;
  targetNode: string;
  timestamp: string;
  inputKey?: string;
  payload?: unknown;
  size?: number;
  type?: string;
  visualTime?: number;
}

export interface AgentTimelineMarker {
  id: string;
  nodeId: string;
  label: string;
  timestamp: string;
}

export interface TimelineState {
  // Run selection
  selectedRunId: string | null;

  // Timeline state
  events: TimelineEvent[];
  dataFlows: DataPacket[];
  totalDuration: number; // presentation duration used by the UI (may include clock interpolation)
  eventDuration: number; // duration derived purely from ingested events (authoritative data)
  timelineStartTime: number | null;
  clockOffset: number | null; // Clock offset: serverTime - clientTime (calculated once, reused)
  currentTime: number; // Current position in timeline (ms)
  playbackMode: 'live' | 'replay';

  // Playback controls
  isPlaying: boolean;
  playbackSpeed: number; // 0.1, 0.5, 1, 2, 5, 10
  isSeeking: boolean;

  // Node states for visualization
  nodeStates: Record<string, NodeVisualState>;
  selectedNodeId: string | null;
  // Per-run node selection history - remembers which node was selected for each run
  nodeSelectionHistory: Record<string, string | null>;
  selectedEventId: string | null;

  // UI state
  showTimeline: boolean;
  showEventInspector: boolean;
  timelineZoom: number; // 1.0 - 100.0
  isLiveFollowing: boolean;
  agentMarkersRunId: string | null;
  agentMarkers: Record<string, AgentTimelineMarker[]>;
}

export interface TimelineActions {
  // Run management
  selectRun: (runId: string, initialMode?: 'live' | 'replay') => Promise<void>;

  // Timeline loading
  loadTimeline: (runId: string) => Promise<void>;

  // Playback controls
  play: () => void;
  pause: () => void;
  seek: (timeMs: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  stepForward: () => void;
  stepBackward: () => void;

  // Node interaction
  selectNode: (nodeId: string | null) => void;
  selectEvent: (eventId: string | null) => void;

  // UI controls
  toggleTimeline: () => void;
  toggleEventInspector: () => void;
  setTimelineZoom: (zoom: number) => void;

  // Live updates
  updateFromLiveEvent: (event: ExecutionLog) => void;
  switchToLiveMode: () => void;
  appendDataFlows: (packets: RawDataPacket[]) => void;

  goLive: () => void;
  tickLiveClock: () => void;

  setAgentMarkers: (runId: string, nodeId: string, markers: AgentTimelineMarker[]) => void;

  // Cleanup
  reset: () => void;
}

export type TimelineStore = TimelineState & TimelineActions;

// Re-export schema types used by consumers
export type { ExecutionLog, ExecutionStatusResponse, NodeStatus };
