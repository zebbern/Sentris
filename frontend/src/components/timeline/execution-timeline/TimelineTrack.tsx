import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { EVENT_COLORS } from './constants';
import { formatTime, formatTimestamp } from './utils';
import type { TimelineTrackProps } from './types';

export const TimelineTrack = forwardRef<HTMLDivElement, TimelineTrackProps>(function TimelineTrack(
  {
    visibleProgress,
    visibleMarkers,
    visibleAgentMarkers,
    isLiveMode,
    playbackMode,
    currentTime,
    viewportStartMs,
    viewportEndMs,
    onMouseDown,
    onWheel,
    onPlayheadMouseDown,
  },
  ref,
) {
  const showPlayhead = playbackMode === 'replay' || isLiveMode;

  return (
    <div className="space-y-2 relative">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatTime(viewportStartMs)}</span>
        <span>{formatTime(viewportEndMs)}</span>
      </div>
      <div
        ref={ref}
        className="relative h-14 bg-muted rounded-lg border transition-all hover:border-blue-300/50 overflow-hidden"
        onMouseDown={onMouseDown}
        onWheel={onWheel}
      >
        <div
          className="absolute inset-y-3 left-0 bg-gradient-to-r from-blue-400/30 to-blue-500/40 rounded-r-full"
          style={{ width: `${visibleProgress * 100}%` }}
        />
        {visibleMarkers.map((marker) => (
          <div
            key={marker.id}
            className={cn(
              'absolute top-3 bottom-3 w-[2px] rounded-full',
              EVENT_COLORS[marker.type] ?? EVENT_COLORS.default,
            )}
            style={{ left: `${marker.viewportPosition * 100}%` }}
            title={`${marker.type} • ${formatTimestamp(marker.timestamp)}`}
          />
        ))}
        {visibleAgentMarkers.map((marker) => (
          <div
            key={`agent-${marker.id}`}
            className="absolute top-1 bottom-1 flex items-center justify-center"
            style={{ left: `${marker.viewportPosition * 100}%` }}
            title={`${marker.label} • ${formatTimestamp(marker.timestamp)}`}
          >
            <div className="w-3 h-3 rotate-45 border border-amber-500 bg-amber-200 shadow-sm" />
          </div>
        ))}
        {showPlayhead && (
          <div className="absolute inset-0 pointer-events-none">
            <div
              className="absolute inset-y-2 w-10 -ml-5 flex flex-col items-center gap-2"
              style={{ left: `${visibleProgress * 100}%` }}
            >
              <div
                className={cn(
                  'flex-1 w-[3px] rounded-full shadow-lg',
                  isLiveMode ? 'bg-red-400' : 'bg-blue-400',
                )}
              />
            </div>
          </div>
        )}
      </div>
      {showPlayhead && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${visibleProgress * 100}%`,
            top: 'calc(100% - 6px)',
            transform: 'translateX(-50%)',
            zIndex: 20,
          }}
        >
          <button
            type="button"
            className={cn(
              'pointer-events-auto relative px-2 py-1 text-xs text-white rounded-md shadow-md whitespace-nowrap',
              isLiveMode ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600',
            )}
            onMouseDown={onPlayheadMouseDown}
          >
            {formatTime(currentTime)}
            <span
              className="absolute -top-1 left-1/2 block h-2 w-2"
              style={{
                transform: 'translateX(-50%) rotate(45deg)',
                backgroundColor: isLiveMode ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
              }}
            />
          </button>
        </div>
      )}
    </div>
  );
});
