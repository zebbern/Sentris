import type { TimelineEvent, NodeVisualState, DataPacket } from '@/store/executionTimelineStore';

export type { TimelineEvent, NodeVisualState, DataPacket };

export type EventLayoutVariant = 'stacked-soft' | 'stacked-contrast' | 'stacked-rail';

export interface EventInspectorProps {
  className?: string;
  layoutVariant?: EventLayoutVariant;
}

export interface EventInspectorHeaderProps {
  selectedRunId: string | null;
  selectedNodeId: string | null;
  filteredEventsCount: number;
  displayEventsCount: number;
  playbackMode: 'live' | 'replay';
  isPlaying: boolean;
  isAutoScrolling: boolean;
  onClearNodeFilter: () => void;
}

export interface EventCardProps {
  event: TimelineEvent;
  isExpanded: boolean;
  isSelected: boolean;
  isCurrent: boolean;
  isRecentLiveEvent: boolean;
  isCurrentReplayEvent: boolean;
  layoutVariant: EventLayoutVariant;
  nodeState: NodeVisualState | undefined;
  relatedFlows: DataPacket[];
  onToggle: (event: TimelineEvent, hasExpandableContent: boolean) => void;
  onOpenFullMessage: (message: string, event: TimelineEvent) => void;
  onOpenDiagnostics: (eventId: string) => void;
}

export interface EventDiagnosticsDialogProps {
  event: TimelineEvent | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  displayEvents: TimelineEvent[];
  nodeState: NodeVisualState | undefined;
  relatedFlows: DataPacket[];
}
