import { Play, Pause, SkipBack, SkipForward, Flame, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { PLAYBACK_SPEEDS } from './constants';
import type { PlaybackControlsProps } from './types';

const segmentedGroupClass =
  'inline-flex shrink-0 items-center rounded-md border bg-background p-0.5';
const segmentedButtonClass = 'h-6 shrink-0 px-0 text-xs';
const segmentedIconButtonClass = 'h-6 w-6 shrink-0 p-0';

export function PlaybackControls({
  currentTime,
  totalDuration,
  isPlaying,
  playbackMode,
  playbackSpeed,
  isLiveFollowing,
  showHeatMap,
  smartRouting,
  onPlayPause,
  onStepForward,
  onStepBackward,
  onSpeedChange,
  onGoLive,
  onToggleHeatMap,
  onToggleSmartRouting,
}: PlaybackControlsProps) {
  const isLiveMode = playbackMode === 'live';

  return (
    <div className="flex min-w-0 w-full flex-wrap items-center gap-2">
      <div className={segmentedGroupClass}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onStepBackward}
          disabled={currentTime <= 0}
          aria-label="Step backward"
          className={segmentedIconButtonClass}
        >
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onPlayPause}
          disabled={playbackMode === 'live'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className={segmentedIconButtonClass}
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onStepForward}
          disabled={currentTime >= totalDuration}
          aria-label="Step forward"
          className={segmentedIconButtonClass}
        >
          <SkipForward className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className={segmentedGroupClass}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={playbackMode === 'live'}
              className={cn(segmentedButtonClass, 'min-w-[2.75rem] px-2')}
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

      <div className={cn(segmentedGroupClass, 'max-w-full')}>
        <span
          className={cn(
            'inline-flex h-6 shrink-0 items-center px-2 text-[11px] font-medium uppercase tracking-wide',
            isLiveMode ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {isLiveMode ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              LIVE
            </span>
          ) : (
            'EXECUTION'
          )}
        </span>
        <Button
          variant={showHeatMap ? 'default' : 'ghost'}
          size="sm"
          onClick={onToggleHeatMap}
          aria-label={showHeatMap ? 'Disable heat map' : 'Enable heat map'}
          className={cn(
            segmentedButtonClass,
            'gap-1 px-2',
            showHeatMap && 'bg-orange-500 text-white hover:bg-orange-600',
          )}
        >
          <Flame className="h-3 w-3 shrink-0" />
          <span className="hidden sm:inline">Heat Map</span>
        </Button>
        <Button
          variant={smartRouting ? 'default' : 'ghost'}
          size="sm"
          onClick={onToggleSmartRouting}
          aria-label={smartRouting ? 'Disable smart routing' : 'Enable smart routing'}
          className={cn(
            segmentedButtonClass,
            'gap-1 px-2',
            smartRouting && 'bg-sky-500 text-white hover:bg-sky-600',
          )}
        >
          <Route className="h-3 w-3 shrink-0" />
          <span className="hidden sm:inline">Smart Routing</span>
        </Button>
      </div>

      {isLiveMode && !isLiveFollowing && (
        <div className={segmentedGroupClass}>
          <span className="inline-flex h-6 items-center px-2 text-[11px] text-red-500">
            Behind live
          </span>
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
