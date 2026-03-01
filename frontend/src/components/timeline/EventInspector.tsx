import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MessageModal } from '@/components/ui/MessageModal';
import { useExecutionTimelineStore, type TimelineEvent } from '@/store/executionTimelineStore';
import { cn } from '@/lib/utils';
import { EventInspectorHeader } from './event-inspector/EventInspectorHeader';
import { EventCard } from './event-inspector/EventCard';
import { EventDiagnosticsDialog } from './event-inspector/EventDiagnosticsDialog';
import type { EventInspectorProps } from './event-inspector/types';

export type { EventLayoutVariant } from './event-inspector/types';

export function EventInspector({ className, layoutVariant = 'stacked-soft' }: EventInspectorProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [fullMessageModal, setFullMessageModal] = useState<{
    open: boolean;
    message: string;
    title: string;
  }>({
    open: false,
    message: '',
    title: '',
  });
  const [diagnosticsDialogOpen, setDiagnosticsDialogOpen] = useState<string | null>(null);
  const autoSelectionSignatureRef = useRef<string | null>(null);
  const eventsListRef = useRef<HTMLUListElement>(null);
  const autoScrollRef = useRef<boolean>(true);

  const selectedRunId = useExecutionTimelineStore((s) => s.selectedRunId);
  const events = useExecutionTimelineStore((s) => s.events);
  const currentTime = useExecutionTimelineStore((s) => s.currentTime);
  const nodeStates = useExecutionTimelineStore((s) => s.nodeStates);
  const dataFlows = useExecutionTimelineStore((s) => s.dataFlows);
  const selectedNodeId = useExecutionTimelineStore((s) => s.selectedNodeId);
  const selectedEventId = useExecutionTimelineStore((s) => s.selectedEventId);
  const selectEvent = useExecutionTimelineStore((s) => s.selectEvent);
  const selectNode = useExecutionTimelineStore((s) => s.selectNode);
  const seek = useExecutionTimelineStore((s) => s.seek);
  const playbackMode = useExecutionTimelineStore((s) => s.playbackMode);
  const isPlaying = useExecutionTimelineStore((s) => s.isPlaying);

  const filteredEvents = useMemo(() => {
    if (!selectedNodeId) {
      return [];
    }
    return events.filter((event) => event.nodeId === selectedNodeId);
  }, [events, selectedNodeId]);

  const displayEvents = filteredEvents.length > 0 ? filteredEvents : events;

  const displaySignature = useMemo(() => {
    if (displayEvents.length === 0) {
      return `${selectedRunId ?? 'none'}|${selectedNodeId ?? 'all'}|empty`;
    }
    const firstId = displayEvents[0].id;
    const lastId = displayEvents[displayEvents.length - 1].id;
    return `${selectedRunId ?? 'none'}|${selectedNodeId ?? 'all'}|${firstId}-${lastId}`;
  }, [displayEvents, selectedRunId, selectedNodeId]);

  useEffect(() => {
    if (displayEvents.length === 0) {
      if (selectedEventId !== null) {
        selectEvent(null);
      }
      autoSelectionSignatureRef.current = displaySignature;
      return;
    }

    const hasSelection =
      selectedEventId && displayEvents.some((event) => event.id === selectedEventId);
    if (!hasSelection) {
      if (selectedEventId === null && autoSelectionSignatureRef.current === displaySignature) {
        return;
      }

      const closestEvent = displayEvents.reduce<{ event: TimelineEvent; diff: number } | null>(
        (closest, event) => {
          const diff = Math.abs(event.offsetMs - currentTime);
          if (!closest || diff < closest.diff) {
            return { event, diff };
          }
          return closest;
        },
        null,
      );

      const fallbackEvent = displayEvents[displayEvents.length - 1];
      selectEvent((closestEvent?.event ?? fallbackEvent).id);
      autoSelectionSignatureRef.current = displaySignature;
      return;
    }

    autoSelectionSignatureRef.current = displaySignature;
  }, [displayEvents, selectedEventId, currentTime, selectEvent, displaySignature]);

  // Auto-scroll to latest event in live mode
  useEffect(() => {
    if (
      playbackMode === 'live' &&
      eventsListRef.current &&
      displayEvents.length > 0 &&
      autoScrollRef.current
    ) {
      // Scroll to the bottom smoothly
      eventsListRef.current.scrollTop = eventsListRef.current.scrollHeight;
    }
  }, [displayEvents.length, playbackMode, events]);

  // Auto-scroll to current event during replay
  useEffect(() => {
    if (
      playbackMode === 'replay' &&
      eventsListRef.current &&
      displayEvents.length > 0 &&
      autoScrollRef.current
    ) {
      // Find the event closest to current time
      const currentEvent = displayEvents.find(
        (event) => Math.abs(event.offsetMs - currentTime) < 300, // Match the EventInspector tolerance
      );

      if (currentEvent) {
        // Find the element for this event
        const eventElement = eventsListRef.current.querySelector(
          `[data-event-id="${currentEvent.id}"]`,
        );
        if (eventElement) {
          eventElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [currentTime, playbackMode, displayEvents, selectedEventId]);

  // Re-enable auto-scroll when playback starts or when seeking to a new position
  useEffect(() => {
    if (isPlaying && playbackMode === 'replay') {
      autoScrollRef.current = true;
    }
  }, [isPlaying, playbackMode]);

  useEffect(() => {
    if (selectedEventId) {
      setExpandedEvents((prev) => {
        if (prev.has(selectedEventId)) return prev;
        const next = new Set(prev);
        next.add(selectedEventId);
        return next;
      });
    }
  }, [selectedEventId]);

  const handleScroll = () => {
    if (eventsListRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = eventsListRef.current;
      // If user has scrolled up from bottom, disable auto-scroll
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10; // 10px tolerance
      autoScrollRef.current = isAtBottom;
    }
  };

  const handleEventToggle = (event: TimelineEvent, hasExpandableContent: boolean) => {
    if (!hasExpandableContent) return;

    if (event.nodeId) {
      selectNode(event.nodeId);
    }
    selectEvent(event.id);
    seek(event.offsetMs);

    // Disable auto-scroll when user manually selects an event
    autoScrollRef.current = false;

    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event.id)) {
        next.delete(event.id);
      } else {
        next.add(event.id);
      }
      return next;
    });
  };

  const openFullMessageModal = (message: string, event: TimelineEvent) => {
    setFullMessageModal({
      open: true,
      message,
      title: `Full Message - ${event.type} - ${event.nodeId || 'System'}`,
    });
  };

  const diagnosticsEvent = diagnosticsDialogOpen
    ? (displayEvents.find((e) => e.id === diagnosticsDialogOpen) ?? null)
    : null;

  const diagnosticsNodeState = diagnosticsEvent?.nodeId
    ? nodeStates[diagnosticsEvent.nodeId]
    : undefined;

  const diagnosticsRelatedFlows = diagnosticsEvent?.nodeId
    ? dataFlows.filter(
        (flow) =>
          flow.sourceNode === diagnosticsEvent.nodeId ||
          flow.targetNode === diagnosticsEvent.nodeId,
      )
    : [];

  return (
    <React.Fragment>
      <div className={cn('flex h-full min-h-0 flex-col', className)}>
        <EventInspectorHeader
          selectedRunId={selectedRunId}
          selectedNodeId={selectedNodeId}
          filteredEventsCount={filteredEvents.length}
          displayEventsCount={displayEvents.length}
          playbackMode={playbackMode}
          isPlaying={isPlaying}
          isAutoScrolling={autoScrollRef.current}
          onClearNodeFilter={() => selectNode(null)}
        />

        <div
          className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40"
          onScroll={handleScroll}
        >
          {displayEvents.length === 0 ? (
            <div className="px-4 py-8 text-xs text-muted-foreground">No events available.</div>
          ) : (
            <ul ref={eventsListRef} className="divide-y divide-border">
              {displayEvents.map((event, index) => {
                const isLatestEvent = index === displayEvents.length - 1;
                const isCurrent = Math.abs(event.offsetMs - currentTime) < 500;
                const nodeState = event.nodeId ? nodeStates[event.nodeId] : undefined;
                const relatedFlows = event.nodeId
                  ? dataFlows.filter(
                      (flow) =>
                        flow.sourceNode === event.nodeId || flow.targetNode === event.nodeId,
                    )
                  : [];

                return (
                  <EventCard
                    key={event.id}
                    event={event}
                    isExpanded={expandedEvents.has(event.id)}
                    isSelected={event.id === selectedEventId}
                    isCurrent={isCurrent}
                    isRecentLiveEvent={playbackMode === 'live' && isLatestEvent}
                    isCurrentReplayEvent={playbackMode === 'replay' && isCurrent}
                    layoutVariant={layoutVariant}
                    nodeState={nodeState}
                    relatedFlows={relatedFlows}
                    onToggle={handleEventToggle}
                    onOpenFullMessage={openFullMessageModal}
                    onOpenDiagnostics={(eventId) => setDiagnosticsDialogOpen(eventId)}
                  />
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <EventDiagnosticsDialog
        event={diagnosticsEvent}
        isOpen={diagnosticsDialogOpen !== null}
        onOpenChange={(open) => setDiagnosticsDialogOpen(open ? diagnosticsDialogOpen : null)}
        displayEvents={displayEvents}
        nodeState={diagnosticsNodeState}
        relatedFlows={diagnosticsRelatedFlows}
      />

      <MessageModal
        open={fullMessageModal.open}
        onOpenChange={(open) => setFullMessageModal((prev) => ({ ...prev, open }))}
        title={fullMessageModal.title}
        message={fullMessageModal.message}
      />
    </React.Fragment>
  );
}
