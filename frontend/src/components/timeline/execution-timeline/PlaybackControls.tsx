import { Play, Pause, SkipBack, SkipForward, Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { PLAYBACK_SPEEDS } from './constants';
import type { PlaybackControlsProps } from './types';

export function PlaybackControls({
  currentTime,
  totalDuration,
  isPlaying,
  playbackMode,
  playbackSpeed,
  isLiveFollowing,
  showHeatMap,
  onPlayPause,
  onStepForward,
  onStepBackward,
  onSpeedChange,
  onGoLive,
  onToggleHeatMap,
}: PlaybackControlsProps) {
  const isLiveMode = playbackMode === 'live';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={onStepBackward}
            disabled={currentTime <= 0}
            aria-label="Step backward"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onPlayPause}
            disabled={playbackMode === 'live'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onStepForward}
            disabled={currentTime >= totalDuration}
            aria-label="Step forward"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={playbackMode === 'live'}
              className="w-16 justify-between"
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
        <Badge variant={isLiveMode ? 'default' : 'secondary'} className="flex items-center gap-1">
          {isLiveMode ? (
            <>
              <div className="w-2 h-2 bg-current rounded-full animate-pulse" />
              LIVE
            </>
          ) : (
            'EXECUTION'
          )}
        </Badge>
        <Button
          variant={showHeatMap ? 'default' : 'outline'}
          size="sm"
          onClick={onToggleHeatMap}
          aria-label={showHeatMap ? 'Disable heat map' : 'Enable heat map'}
          className={cn('gap-1.5', showHeatMap && 'bg-orange-500 hover:bg-orange-600 text-white')}
        >
          <Flame className="h-4 w-4" />
          Heat Map
        </Button>
        {isLiveMode && !isLiveFollowing && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-red-500 border-red-400 bg-red-50">
              Behind live
            </Badge>
            <Button size="sm" onClick={onGoLive} className="bg-red-500 text-white hover:bg-red-600">
              Go Live
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
