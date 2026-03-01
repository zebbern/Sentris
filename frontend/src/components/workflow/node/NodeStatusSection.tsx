import {
  Activity,
  AlertCircle,
  Ban,
  CheckCircle,
  ChevronDown,
  ExternalLink,
  Pause,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExecutionErrorView } from '../ExecutionErrorView';
import { NodeProgressBar } from './NodeProgressBar';
import type { NodeVisualState } from '@/store/executionTimelineStore';

export interface NodeStatusSectionProps {
  visualState: NodeVisualState;
  playbackMode: string;
  isPlaying: boolean;
  showErrorDetails: boolean;
  setShowErrorDetails: (v: boolean) => void;
  componentCategory: string;
  navigate: (path: string) => void;
}

/**
 * Renders the status badge section shown during execution timeline playback.
 * Includes running/success/error/skipped badges, child-run link, error details, and progress bar.
 */
export function NodeStatusSection({
  visualState,
  playbackMode,
  isPlaying,
  showErrorDetails,
  setShowErrorDetails,
  componentCategory,
  navigate,
}: NodeStatusSectionProps) {
  return (
    <div className="px-3 py-2 border-b border-border/50 bg-muted/30 space-y-2">
      {visualState.status === 'running' && (
        <Badge
          variant="secondary"
          className="text-xs bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700"
        >
          {playbackMode === 'live' ? (
            <>
              <Activity className="h-3 w-3 mr-1 animate-pulse" />
              Live
            </>
          ) : isPlaying ? (
            <>
              <Activity className="h-3 w-3 mr-1" />
              Running
            </>
          ) : (
            <>
              <Pause className="h-3 w-3 mr-1" />
              Paused
            </>
          )}
        </Badge>
      )}
      {visualState.status === 'success' && (
        <Badge
          variant="secondary"
          className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-700"
        >
          <CheckCircle className="h-3 w-3 mr-1" />
          {componentCategory === 'mcp' ? 'Server Ready' : 'Completed'}
        </Badge>
      )}
      {visualState.status === 'error' && (
        <Badge
          variant="secondary"
          className={cn(
            'text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 cursor-pointer select-none transition-all hover:ring-2 hover:ring-red-400/50 items-center gap-1',
            showErrorDetails && 'ring-2 ring-red-400/50',
          )}
          onClick={() => setShowErrorDetails(!showErrorDetails)}
          title="Click to toggle error details"
        >
          <AlertCircle className="h-3 w-3" />
          <span>{visualState.lastEvent?.error?.type || 'Failed'}</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 transition-transform duration-200',
              showErrorDetails && 'rotate-180',
            )}
          />
        </Badge>
      )}
      {visualState.status === 'skipped' && (
        <Badge
          variant="secondary"
          className="text-xs bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-600"
        >
          <Ban className="h-3 w-3 mr-1" />
          Skipped
        </Badge>
      )}
      {visualState.lastMetadata?.childRunId && (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs font-medium gap-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/20 dark:hover:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/runs/${visualState.lastMetadata!.childRunId}`);
          }}
        >
          <ExternalLink className="h-3 w-3" />
          View Child Run
        </Button>
      )}
      {visualState.status === 'error' && showErrorDetails && visualState.lastEvent?.error && (
        <ExecutionErrorView error={visualState.lastEvent.error} className="mt-2" />
      )}
      <NodeProgressBar
        progress={Number.isFinite(visualState.progress) ? visualState.progress : 0}
        events={visualState.eventCount}
        totalEvents={visualState.totalEvents}
        isRunning={visualState.status === 'running'}
        status={visualState.status}
      />
    </div>
  );
}
