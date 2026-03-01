import type { TimelineStatusBarProps } from './types';

export function TimelineStatusBar({
  eventCount,
  nodeCount,
  playbackSpeed,
  playbackMode,
  isSeeking,
  isPlaying,
}: TimelineStatusBarProps) {
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        <span>{eventCount} events</span>
        <span>{nodeCount} nodes</span>
        {playbackMode === 'replay' && <span>Speed: {playbackSpeed}x</span>}
      </div>
      <div className="flex items-center gap-4">
        {isSeeking && <span className="text-blue-500">Seeking...</span>}
        {isPlaying && playbackMode === 'replay' && (
          <span className="text-green-500">Playing...</span>
        )}
      </div>
    </div>
  );
}
