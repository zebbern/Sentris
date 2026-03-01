export interface MarkerData {
  id: string;
  type: string;
  timestamp: string;
  viewportPosition: number;
  normalizedPosition: number;
  visible: boolean;
}

export interface AgentMarkerData {
  id: string;
  label: string;
  timestamp: string;
  viewportPosition: number;
  normalizedPosition: number;
  visible: boolean;
}

export interface PlaybackControlsProps {
  currentTime: number;
  totalDuration: number;
  isPlaying: boolean;
  playbackMode: 'live' | 'replay';
  playbackSpeed: number;
  isLiveFollowing: boolean;
  onPlayPause: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onSpeedChange: (speed: number) => void;
  onGoLive: () => void;
}

export interface TimelineTrackProps {
  visibleProgress: number;
  visibleMarkers: MarkerData[];
  visibleAgentMarkers: AgentMarkerData[];
  isLiveMode: boolean;
  playbackMode: 'live' | 'replay';
  currentTime: number;
  viewportStartMs: number;
  viewportEndMs: number;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  onPlayheadMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export interface TimelineOverviewProps {
  markerData: MarkerData[];
  clampedStart: number;
  viewportWidth: number;
  normalizedProgress: number;
  isLiveMode: boolean;
  timelineZoom: number;
  overviewDuration: number;
  onPreviewPointer: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export interface TimelineStatusBarProps {
  eventCount: number;
  nodeCount: number;
  playbackSpeed: number;
  playbackMode: 'live' | 'replay';
  isSeeking: boolean;
  isPlaying: boolean;
}
