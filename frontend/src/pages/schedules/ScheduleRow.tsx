import type { useSortable } from '@dnd-kit/sortable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell } from '@/components/ui/table';
import { DragHandle } from '@/components/ui/sortable';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PauseCircle, PlayCircle, Edit3, Trash2 } from 'lucide-react';
import type { WorkflowSchedule } from '@sentris/shared';
import type { StatusBadgeProps } from '@/utils/tableHelpers';
import { formatDateTime } from '@/utils/timeFormat';

export interface ScheduleRowHandleProps {
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
}

export interface ScheduleRowProps {
  schedule: WorkflowSchedule;
  handleProps: ScheduleRowHandleProps;
  isSelected: boolean;
  isDragDisabled: boolean;
  workflowName: string;
  cadenceLabel: string;
  statusBadgeProps: StatusBadgeProps;
  isActionBusy: boolean;
  onToggle: () => void;
  onRunNow: (schedule: WorkflowSchedule) => void;
  onPauseResume: (schedule: WorkflowSchedule) => void;
  onEdit: (schedule: WorkflowSchedule) => void;
  onDelete: (schedule: WorkflowSchedule) => void;
}

export function ScheduleRow({
  schedule,
  handleProps,
  isSelected,
  isDragDisabled,
  workflowName,
  cadenceLabel,
  statusBadgeProps,
  isActionBusy,
  onToggle,
  onRunNow,
  onPauseResume,
  onEdit,
  onDelete,
}: ScheduleRowProps) {
  const isPaused = schedule.status !== 'active';

  return (
    <>
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          aria-label={`Select ${schedule.name}`}
        />
      </TableCell>
      <DragHandle {...handleProps} disabled={isDragDisabled} />
      <TableCell className="font-medium">
        <div className="flex flex-col">
          <span className="truncate max-w-[120px] md:max-w-none">{schedule.name}</span>
          {schedule.description && (
            <span className="text-xs text-muted-foreground truncate max-w-[120px] md:max-w-none">
              {schedule.description}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex flex-col">
          <span className="font-medium truncate max-w-[120px]">{workflowName}</span>
          <span className="text-xs text-muted-foreground truncate max-w-[120px]">
            {schedule.workflowId}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <div className="flex flex-col">
          <span className="text-sm">{cadenceLabel}</span>
          <span className="text-xs text-muted-foreground">{schedule.timezone}</span>
        </div>
      </TableCell>
      <TableCell className="text-sm hidden sm:table-cell whitespace-nowrap">
        {formatDateTime(schedule.nextRunAt)}
      </TableCell>
      <TableCell className="text-sm hidden lg:table-cell whitespace-nowrap">
        {formatDateTime(schedule.lastRunAt)}
      </TableCell>
      <TableCell className="hidden sm:table-cell whitespace-nowrap">
        <Badge variant={statusBadgeProps.variant}>{statusBadgeProps.label}</Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1 md:gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 px-2 md:px-3"
            onClick={() => onRunNow(schedule)}
            disabled={isActionBusy}
            aria-label={`Run ${schedule.name} now`}
          >
            <PlayCircle className="h-4 w-4" />
            <span className="hidden md:inline">Run</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1 h-8 px-2 md:px-3"
            onClick={() => onPauseResume(schedule)}
            disabled={isActionBusy}
            aria-label={isPaused ? `Resume ${schedule.name}` : `Pause ${schedule.name}`}
          >
            {isPaused ? (
              <>
                <PlayCircle className="h-4 w-4" />
                <span className="hidden md:inline">Resume</span>
              </>
            ) : (
              <>
                <PauseCircle className="h-4 w-4" />
                <span className="hidden md:inline">Pause</span>
              </>
            )}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit schedule"
                onClick={() => onEdit(schedule)}
                className="h-8 w-8"
              >
                <Edit3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit schedule configuration</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete schedule"
                onClick={() => onDelete(schedule)}
                disabled={isActionBusy}
                className="h-8 w-8"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete schedule</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </>
  );
}
