import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { PLAYBACK_SPEEDS } from './constants';
import type { PlaybackControlsProps, TimelineViewTogglesProps } from './types';

const transportGroupClass =
  'inline-flex shrink-0 items-center rounded-md border bg-background p-0.5';
const transportIconButtonClass = 'h-6 w-6 shrink-0 p-0';
const transportButtonClass = 'h-6 shrink-0 px-0 text-xs';

export function TimelineViewToggles({
  playbackMode,
  isLiveFollowing,
  onGoLive,
}: TimelineViewTogglesProps) {
  const isLiveMode = playbackMode === 'live';

  if (!isLiveMode) return null;

  return (
    <div className="flex min-w-0 w-full flex-wrap items-center justify-end gap-1.5">
      <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 text-[11px] font-medium uppercase tracking-wide text-primary">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        LIVE
      </span>

      {!isLiveFollowing && (
        <div className="inline-flex items-center gap-1.5">
          <span className="text-[11px] text-red-500">Behind live</span>
          <Button
            size="sm"
            onClick={onGoLive}
            className="h-6 shrink-0 px-2 text-xs bg-red-500 text-white hover:bg-red-600"
          >
            Go Live
          </Button>
        </div>
      )}
    </div>
  );
}

export function PlaybackControls({
  currentTime,
  totalDuration,
  isPlaying,
  playbackMode,
  playbackSpeed,
  onPlayPause,
  onStepForward,
  onStepBackward,
  onSpeedChange,
}: PlaybackControlsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className={transportGroupClass}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onStepBackward}
          disabled={currentTime <= 0}
          aria-label="Step backward"
          className={transportIconButtonClass}
        >
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onPlayPause}
          disabled={playbackMode === 'live'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className={transportIconButtonClass}
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onStepForward}
          disabled={currentTime >= totalDuration}
          aria-label="Step forward"
          className={transportIconButtonClass}
        >
          <SkipForward className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className={transportGroupClass}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={playbackMode === 'live'}
              className={cn(transportButtonClass, 'min-w-[2.75rem] px-2')}
            >
              {playbackSpeed}x
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {PLAYBACK_SPEEDS.map((speed) => (
              <DropdownMenuItem
                key={speed.value}
                onClick={() => onSpeedChange(speed.value)}
                className={cn(playbackSpeed === speed.value && 'bg-accent')}
              >
                {speed.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
