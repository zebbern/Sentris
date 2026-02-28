import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useExecutionStore, type TrackedRun } from '@/store/executionStore';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const STATUS_DOT: Record<TrackedRun['status'], string> = {
  idle: 'bg-slate-400',
  queued: 'bg-amber-400',
  running: 'bg-green-500 animate-pulse',
  completed: 'bg-slate-400',
  failed: 'bg-red-500',
  cancelled: 'bg-orange-400',
};

const STATUS_LABEL: Record<TrackedRun['status'], string> = {
  idle: 'Idle',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function truncateName(name: string | undefined, maxLength = 18): string {
  if (!name) return 'Untitled';
  return name.length > maxLength ? `${name.slice(0, maxLength)}…` : name;
}

export function ExecutionTabs() {
  const trackedRuns = useExecutionStore((s) => s.trackedRuns);
  const activeRunId = useExecutionStore((s) => s.runId);
  const switchToRun = useExecutionStore((s) => s.switchToRun);
  const removeTrackedRun = useExecutionStore((s) => s.removeTrackedRun);
  const disconnectStream = useExecutionStore((s) => s.disconnectStream);

  const handleClose = useCallback(
    (e: React.SyntheticEvent, runId: string) => {
      e.stopPropagation();
      // If closing the active tab, just disconnect; the user will need
      // to pick another tab or start a new run.
      if (runId === activeRunId) {
        disconnectStream();
      }
      removeTrackedRun(runId);
    },
    [activeRunId, disconnectStream, removeTrackedRun],
  );

  // Don't render tabs when there's 0 or 1 tracked run — no switching needed
  if (trackedRuns.length <= 1) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex items-center gap-1 overflow-x-auto border-b bg-muted/40 px-2 py-1"
        role="tablist"
        aria-label="Tracked workflow runs"
      >
        {trackedRuns.map((run) => {
          const isActive = run.runId === activeRunId;
          return (
            <Tooltip key={run.runId}>
              <TooltipTrigger asChild>
                <button
                  role="tab"
                  aria-selected={isActive}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    'hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    isActive
                      ? 'bg-background text-foreground shadow-sm border'
                      : 'text-muted-foreground',
                  )}
                  onClick={() => switchToRun(run.runId)}
                >
                  <span
                    className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[run.status])}
                    aria-hidden="true"
                  />
                  <span className="truncate max-w-[120px]">{truncateName(run.workflowName)}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Close ${run.workflowName ?? 'run'}`}
                    className={cn(
                      'ml-0.5 shrink-0 rounded p-0.5 transition-colors',
                      'hover:bg-destructive/20 hover:text-destructive',
                      'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                    )}
                    onClick={(e) => handleClose(e, run.runId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleClose(e, run.runId);
                      }
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p className="font-medium">{run.workflowName ?? 'Untitled'}</p>
                <p className="text-muted-foreground">
                  {STATUS_LABEL[run.status]} · {run.runId.slice(0, 8)}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
