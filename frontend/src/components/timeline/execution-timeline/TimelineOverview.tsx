import { cn } from '@/lib/utils';
import { EVENT_COLORS } from './constants';
import { formatTime } from './utils';
import type { TimelineOverviewProps } from './types';

export function TimelineOverview({
  markerData,
  clampedStart,
  viewportWidth,
  normalizedProgress,
  isLiveMode,
  timelineZoom,
  overviewDuration,
  onPreviewPointer,
}: TimelineOverviewProps) {
  return (
    <div className="space-y-2 mt-4 pt-2 border-t border-border/50">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Timeline Overview</span>
        <span className="text-blue-600 dark:text-blue-400">
          {timelineZoom > 1 ? `Zoom: ${Math.round(timelineZoom * 100)}%` : ''}
        </span>
      </div>
      <div
        className="relative h-8 bg-muted rounded-lg border cursor-pointer"
        onMouseDown={onPreviewPointer}
        onMouseMove={(event) => {
          if (event.buttons & 1) {
            onPreviewPointer(event);
          }
        }}
        title="Click or drag to reposition view"
      >
        {markerData.map((marker) => (
          <div
            key={`preview-${marker.id}`}
            className={cn(
              'absolute top-2 bottom-2 w-[2px] rounded-full opacity-30',
              EVENT_COLORS[marker.type] ?? EVENT_COLORS.default,
            )}
            style={{ left: `${marker.normalizedPosition * 100}%` }}
          />
        ))}
        <div
          className="absolute top-0 bottom-0 bg-blue-500/20 border border-blue-400/40 rounded"
          style={{ left: `${clampedStart * 100}%`, width: `${viewportWidth * 100}%` }}
        />
      </div>
      <div className="relative h-3 pointer-events-none" aria-hidden="true">
        <div
          className="absolute"
          style={{
            left: `${normalizedProgress * 100}%`,
            top: 0,
            transform: 'translate(-50%, 0)',
            color: isLiveMode ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
          }}
        >
          <div
            className="w-0 h-0"
            style={{
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderBottom: '8px solid currentColor',
            }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatTime(0)}</span>
        <span>{formatTime(overviewDuration)}</span>
      </div>
    </div>
  );
}
