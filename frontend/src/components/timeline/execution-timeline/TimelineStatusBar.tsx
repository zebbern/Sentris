import { cn } from '@/lib/utils';
import type { TimelineStatusBarProps } from './types';

export function TimelineStatusCounts({
  eventCount,
  nodeCount,
  className,
}: Pick<TimelineStatusBarProps, 'eventCount' | 'nodeCount' | 'className'>) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums',
        className,
      )}
    >
      <span>
        {eventCount} {eventCount === 1 ? 'event' : 'events'}
      </span>
      <span aria-hidden="true" className="text-border">
        ·
      </span>
      <span>
        {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}
      </span>
    </div>
  );
}

export function TimelinePlaybackState({
  playbackMode,
  isSeeking,
  isPlaying,
  className,
}: Pick<TimelineStatusBarProps, 'playbackMode' | 'isSeeking' | 'isPlaying' | 'className'>) {
  if (!isSeeking && !(isPlaying && playbackMode === 'replay')) {
    return <div className={className} />;
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {isSeeking && (
        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-400">
          Seeking
        </span>
      )}
      {isPlaying && playbackMode === 'replay' && (
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
          Playing
        </span>
      )}
    </div>
  );
}
