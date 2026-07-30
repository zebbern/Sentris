import { useCallback, useState } from 'react';
import {
  Loader2,
  Plus,
  X,
  Pause,
  Play,
  Zap,
  Pencil,
  Trash2,
  Clock,
  ChevronsRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import type { WorkflowSchedule } from '@sentris/shared';
import { formatScheduleTimestamp, scheduleStatusVariant } from './schedules-utils';

export interface WorkflowSchedulesSummaryBarProps {
  schedules: WorkflowSchedule[];
  isLoading: boolean;
  error?: string | null;
  onCreate: () => void;
  onExpand: () => void;
  onViewAll: () => void;
}

export function WorkflowSchedulesSummaryBar({
  schedules,
  isLoading,
  error,
  onCreate,
  onExpand,
  onViewAll,
}: WorkflowSchedulesSummaryBarProps) {
  const collapsed = useUserPreferencesStore((s) => s.schedulesSummaryCollapsed);
  const setCollapsed = useUserPreferencesStore((s) => s.setSchedulesSummaryCollapsed);
  const countActive = schedules.filter((s) => s.status === 'active').length;
  const countPaused = schedules.filter((s) => s.status === 'paused').length;
  const countError = schedules.filter((s) => s.status === 'error').length;
  const scheduleCount = schedules.length;

  if (collapsed) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="pointer-events-auto relative h-10 w-10 rounded-xl border bg-background/95 shadow-sm ring-1 ring-border/60"
              onClick={() => setCollapsed(false)}
              aria-label="Show schedules"
            >
              <Clock className="h-4 w-4 text-primary" />
              {scheduleCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                  {scheduleCount > 9 ? '9+' : scheduleCount}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Show schedules</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="pointer-events-auto flex flex-col gap-2 rounded-xl border bg-background/95 px-3 py-2 ring-1 ring-border/60 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 space-y-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Schedules
            </div>
            <div className="text-[11px] text-muted-foreground">
              {isLoading ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading…
                </span>
              ) : error ? (
                <span className="text-destructive">{error}</span>
              ) : schedules.length === 0 ? (
                <span>No schedules</span>
              ) : (
                <>
                  {countActive > 0 && <span>{countActive} active</span>}
                  {countPaused > 0 && <span className="ml-2">{countPaused} paused</span>}
                  {countError > 0 && (
                    <span className="ml-2 text-destructive">{countError} error</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                aria-label="Hide schedules"
                onClick={() => setCollapsed(true)}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Hide to corner</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex items-center justify-center gap-1.5">
        <Button type="button" size="sm" className="h-7 px-2.5 text-xs" onClick={onCreate}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          New
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 px-2.5 text-xs"
          onClick={onExpand}
        >
          Manage
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs"
          aria-label="Open schedules"
          onClick={onViewAll}
        >
          Open
        </Button>
      </div>
    </div>
  );
}

export interface WorkflowSchedulesSidebarProps {
  schedules: WorkflowSchedule[];
  isLoading: boolean;
  error?: string | null;
  onClose: () => void;
  onCreate: () => void;
  onManage: () => void;
  onEdit: (schedule: WorkflowSchedule) => void;
  onAction: (
    schedule: WorkflowSchedule,
    action: 'pause' | 'resume' | 'run',
  ) => Promise<void> | void;
  onDelete: (schedule: WorkflowSchedule) => Promise<void> | void;
}

export function WorkflowSchedulesSidebar({
  schedules,
  isLoading,
  error,
  onClose,
  onCreate,
  onManage,
  onEdit,
  onAction,
  onDelete,
}: WorkflowSchedulesSidebarProps) {
  const [actionState, setActionState] = useState<Record<string, 'pause' | 'resume' | 'run'>>({});

  const handleAction = useCallback(
    async (schedule: WorkflowSchedule, action: 'pause' | 'resume' | 'run') => {
      setActionState((state) => ({ ...state, [schedule.id]: action }));
      try {
        await onAction(schedule, action);
      } finally {
        setActionState((state) => {
          const { [schedule.id]: _removed, ...rest } = state;
          return rest;
        });
      }
    },
    [onAction],
  );

  return (
    <div className="flex h-full flex-col border-l bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">Schedules</h3>
          <Badge variant="outline" className="text-[11px] font-medium">
            {schedules.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-muted"
          onClick={onClose}
          aria-label="Close schedules panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-4 py-3 border-b bg-muted/20">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onCreate}>
            <Plus className="mr-1 h-4 w-4" />
            New
          </Button>
          <Button size="sm" variant="outline" onClick={onManage}>
            View page
          </Button>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading schedules…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : schedules.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No schedules yet. Create one to run this workflow automatically.
          </div>
        ) : (
          schedules.map((schedule) => {
            const isActive = schedule.status === 'active';
            const actionLabel = isActive ? 'Pause' : 'Resume';
            const actionKey = isActive ? 'pause' : 'resume';
            const pendingAction = actionState[schedule.id];
            return (
              <div key={schedule.id} className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-sm font-semibold truncate min-w-0">
                              {schedule.name}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">{schedule.name}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Badge
                        variant={scheduleStatusVariant[schedule.status]}
                        className="text-[11px] capitalize flex-shrink-0"
                      >
                        {schedule.status}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Next: {formatScheduleTimestamp(schedule.nextRunAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      disabled={Boolean(pendingAction && pendingAction !== actionKey)}
                      onClick={() => handleAction(schedule, actionKey as 'pause' | 'resume')}
                      title={actionLabel}
                      aria-label={actionLabel}
                    >
                      {pendingAction === 'pause' || pendingAction === 'resume' ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : isActive ? (
                        <Pause className="mr-1 h-3.5 w-3.5" />
                      ) : (
                        <Play className="mr-1 h-3.5 w-3.5" />
                      )}
                      {actionLabel}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      disabled={Boolean(pendingAction && pendingAction !== 'run')}
                      onClick={() => handleAction(schedule, 'run')}
                      title="Run now"
                      aria-label="Run now"
                    >
                      {pendingAction === 'run' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => onEdit(schedule)}
                      title="Edit schedule"
                      aria-label="Edit schedule"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => onDelete(schedule)}
                      disabled={Boolean(pendingAction)}
                      title="Delete schedule"
                      aria-label="Delete schedule"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {schedule.description && (
                  <p className="text-xs text-muted-foreground">{schedule.description}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
