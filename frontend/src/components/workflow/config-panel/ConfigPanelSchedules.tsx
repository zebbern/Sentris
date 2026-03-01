import { useState, useCallback } from 'react';
import { Loader2, Trash2, Globe, Key } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WebhookDetails } from '../WebhookDetails';
import { formatScheduleTimestamp, scheduleStatusVariant } from '../schedules-utils';
import type { WorkflowSchedule } from '@sentris/shared';

export interface ConfigPanelSchedulesProps {
  workflowId: string | null | undefined;
  workflowInvokeUrl: string;
  entryPointPayload: { inputs: Record<string, unknown> };
  activeApiKey: string | null;
  workflowSchedules?: WorkflowSchedule[];
  schedulesLoading?: boolean;
  scheduleError?: string | null;
  onScheduleCreate?: () => void;
  onScheduleEdit?: (schedule: WorkflowSchedule) => void;
  onScheduleAction?: (
    schedule: WorkflowSchedule,
    action: 'pause' | 'resume' | 'run',
  ) => Promise<void> | void;
  onScheduleDelete?: (schedule: WorkflowSchedule) => Promise<void> | void;
  onViewSchedules?: () => void;
  onOpenWebhooksSidebar?: () => void;
}

export function ConfigPanelSchedules({
  workflowId,
  workflowInvokeUrl,
  entryPointPayload,
  activeApiKey,
  workflowSchedules,
  schedulesLoading,
  scheduleError,
  onScheduleCreate,
  onScheduleEdit,
  onScheduleAction,
  onScheduleDelete,
  onViewSchedules,
  onOpenWebhooksSidebar,
}: ConfigPanelSchedulesProps) {
  const navigate = useNavigate();
  const { confirm: confirmDialog, dialogProps: confirmDialogProps } = useConfirmDialog();
  const [scheduleActionState, setScheduleActionState] = useState<
    Record<string, 'pause' | 'resume' | 'run'>
  >({});

  const schedulesDisabled = !workflowId;

  const handleNavigateSchedules = useCallback(() => {
    if (!workflowId) {
      navigate('/schedules');
      return;
    }
    navigate(`/schedules?workflowId=${workflowId}`);
  }, [navigate, workflowId]);

  const viewSchedules = onViewSchedules ?? handleNavigateSchedules;

  const handleCreateSchedule = useCallback(() => {
    if (schedulesDisabled) {
      viewSchedules();
      return;
    }
    if (onScheduleCreate) {
      onScheduleCreate();
    } else {
      viewSchedules();
    }
  }, [onScheduleCreate, schedulesDisabled, viewSchedules]);

  const handleEditSchedule = useCallback(
    (schedule: WorkflowSchedule) => {
      if (onScheduleEdit) {
        onScheduleEdit(schedule);
      } else {
        viewSchedules();
      }
    },
    [onScheduleEdit, viewSchedules],
  );

  const handleScheduleActionClick = useCallback(
    async (schedule: WorkflowSchedule, action: 'pause' | 'resume' | 'run') => {
      if (!onScheduleAction) {
        viewSchedules();
        return;
      }
      setScheduleActionState((state) => ({ ...state, [schedule.id]: action }));
      try {
        await onScheduleAction(schedule, action);
      } finally {
        setScheduleActionState((state) => {
          const { [schedule.id]: _removed, ...rest } = state;
          return rest;
        });
      }
    },
    [onScheduleAction, viewSchedules],
  );

  return (
    <div className="space-y-4">
      {/* Webhooks section */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <h5 className="text-sm font-semibold text-foreground">Webhooks</h5>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                title="Manage API Keys"
                aria-label="Manage API keys"
                onClick={() => navigate('/api-keys')}
              >
                <Key className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <WebhookDetails
                url={workflowInvokeUrl}
                payload={entryPointPayload}
                apiKey={activeApiKey}
                triggerLabel="View Code"
                className="h-7 text-xs px-2.5 bg-background shadow-xs hover:bg-background/80"
              />
              {workflowId && onOpenWebhooksSidebar && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={onOpenWebhooksSidebar}
                >
                  Manage
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {workflowId
              ? 'Trigger this workflow via HTTP POST. Create custom webhooks to transform payloads.'
              : 'Save this workflow to get webhook URLs.'}
          </p>
        </div>
        {workflowId && (
          <div>
            <div className="text-[11px] uppercase text-muted-foreground mb-1">Default Endpoint</div>
            <div className="relative group">
              <code className="block rounded-lg border bg-background px-3 py-2 text-xs font-mono text-foreground overflow-x-auto break-all">
                {workflowInvokeUrl}
              </code>
            </div>
          </div>
        )}
      </div>

      {/* Schedules section */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="text-sm font-semibold text-foreground">Schedules</h5>
            <p className="text-xs text-muted-foreground">
              {workflowId
                ? 'Create recurring runs and manage Temporal schedules for this workflow.'
                : 'Save this workflow to start managing schedules.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleCreateSchedule}
              disabled={schedulesDisabled}
            >
              Create schedule
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={viewSchedules}>
              View all
            </Button>
          </div>
        </div>
        {schedulesDisabled ? (
          <div className="rounded border border-dashed bg-background/60 px-3 py-2 text-xs text-muted-foreground">
            Save this workflow to configure schedules.
          </div>
        ) : schedulesLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading schedules…
          </div>
        ) : scheduleError ? (
          <div className="rounded border border-dashed border-destructive/50 bg-background/60 px-3 py-2 text-xs text-destructive">
            {scheduleError}
          </div>
        ) : workflowSchedules && workflowSchedules.length > 0 ? (
          <div className="space-y-3">
            {workflowSchedules.map((schedule) => {
              const actionLabel = schedule.status === 'active' ? 'Pause' : 'Resume';
              const actionKey = schedule.status === 'active' ? 'pause' : 'resume';
              const pendingAction = scheduleActionState[schedule.id];
              return (
                <div
                  key={schedule.id}
                  className="rounded-lg border bg-background px-3 py-2 space-y-2"
                >
                  <div className="flex flex-col gap-2">
                    <div className="min-w-0">
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
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={Boolean(pendingAction)}
                        onClick={() =>
                          handleScheduleActionClick(schedule, actionKey as 'pause' | 'resume')
                        }
                      >
                        {pendingAction === 'pause' || pendingAction === 'resume' ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        {actionLabel}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={Boolean(pendingAction)}
                        onClick={() => handleScheduleActionClick(schedule, 'run')}
                      >
                        Run now
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEditSchedule(schedule)}
                      >
                        Edit
                      </Button>
                      {onScheduleDelete && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: 'Delete schedule',
                              description: `Are you sure you want to delete "${schedule.name}"? This action cannot be undone.`,
                              confirmLabel: 'Delete',
                            });
                            if (ok) onScheduleDelete(schedule);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {schedule.description && (
                    <p className="text-xs text-muted-foreground">{schedule.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded border border-dashed bg-background/60 px-3 py-2 text-xs text-muted-foreground">
            No schedules yet.
          </div>
        )}
      </div>
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
