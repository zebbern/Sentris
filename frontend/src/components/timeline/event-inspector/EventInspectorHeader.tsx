import { X } from 'lucide-react';
import type { EventInspectorHeaderProps } from './types';

export function EventInspectorHeader({
  selectedRunId,
  selectedNodeId,
  filteredEventsCount,
  displayEventsCount,
  playbackMode,
  isPlaying,
  isAutoScrolling,
  onClearNodeFilter,
}: EventInspectorHeaderProps) {
  return (
    <div className="border-b px-4 py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Event Inspector</h3>
        <div className="flex items-center gap-2 text-xs">
          {playbackMode === 'live' && (
            <>
              <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="font-medium text-red-600">LIVE</span>
              {isAutoScrolling && <span className="text-muted-foreground">• Auto-scrolling</span>}
            </>
          )}
          {playbackMode === 'replay' && isPlaying && isAutoScrolling && (
            <>
              <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              <span className="font-medium text-blue-600">FOLLOWING</span>
            </>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {selectedRunId
          ? selectedNodeId
            ? filteredEventsCount > 0
              ? `${filteredEventsCount} events for ${selectedNodeId}`
              : `No events for ${selectedNodeId} — showing all`
            : `${displayEventsCount} events across all nodes`
          : 'Select a run to explore execution events.'}
      </p>
      {selectedNodeId && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Node filter</span>
          <button
            type="button"
            onClick={onClearNodeFilter}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 font-medium text-muted-foreground transition hover:bg-muted"
            aria-label="Clear node filter"
          >
            {selectedNodeId}
            <X className="h-3 w-3 opacity-70" />
          </button>
        </div>
      )}
    </div>
  );
}
