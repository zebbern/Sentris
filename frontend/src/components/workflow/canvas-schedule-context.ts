import type { WorkflowSchedule } from '@sentris/shared';
import { useOptionalWorkflowSchedulesContext } from '@/features/workflow-builder/contexts/useWorkflowSchedulesContext';

export interface ScheduleContextProps {
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
  onOpenScheduleSidebar?: () => void;
  onCloseScheduleSidebar?: () => void;
  onCloseWebhooksSidebar?: () => void;
}

export interface ResolvedScheduleContext {
  resolvedWorkflowSchedules: WorkflowSchedule[];
  resolvedSchedulesLoading: boolean;
  resolvedScheduleError: string | null;
  resolvedOnScheduleCreate?: () => void;
  resolvedOnScheduleEdit?: (schedule: WorkflowSchedule) => void;
  resolvedOnScheduleAction?: (
    schedule: WorkflowSchedule,
    action: 'pause' | 'resume' | 'run',
  ) => Promise<void> | void;
  resolvedOnScheduleDelete?: (schedule: WorkflowSchedule) => Promise<void> | void;
  resolvedOnViewSchedules?: () => void;
  resolvedOnOpenScheduleSidebar?: () => void;
  resolvedOnCloseScheduleSidebar?: () => void;
  resolvedOnOpenWebhooksSidebar?: () => void;
  resolvedOnCloseWebhooksSidebar?: () => void;
}

/**
 * Resolves schedule/webhook props by falling back from explicit CanvasProps
 * to the optional WorkflowSchedulesContext. This keeps Canvas.tsx lean
 * while maintaining backward-compatible prop-based overrides.
 */
export function useResolvedScheduleContext(props: ScheduleContextProps): ResolvedScheduleContext {
  const scheduleContext = useOptionalWorkflowSchedulesContext();

  return {
    resolvedWorkflowSchedules: props.workflowSchedules ?? scheduleContext?.schedules ?? [],
    resolvedSchedulesLoading: props.schedulesLoading ?? scheduleContext?.isLoading ?? false,
    resolvedScheduleError: props.scheduleError ?? scheduleContext?.error ?? null,
    resolvedOnScheduleCreate: props.onScheduleCreate ?? scheduleContext?.onScheduleCreate,
    resolvedOnScheduleEdit: props.onScheduleEdit ?? scheduleContext?.onScheduleEdit,
    resolvedOnScheduleAction: props.onScheduleAction ?? scheduleContext?.onScheduleAction,
    resolvedOnScheduleDelete: props.onScheduleDelete ?? scheduleContext?.onScheduleDelete,
    resolvedOnViewSchedules: props.onViewSchedules ?? scheduleContext?.onViewSchedules,
    resolvedOnOpenScheduleSidebar:
      props.onOpenScheduleSidebar ?? scheduleContext?.onOpenScheduleSidebar,
    resolvedOnCloseScheduleSidebar:
      props.onCloseScheduleSidebar ?? scheduleContext?.onCloseScheduleSidebar,
    resolvedOnOpenWebhooksSidebar: scheduleContext?.onOpenWebhooksSidebar,
    resolvedOnCloseWebhooksSidebar:
      props.onCloseWebhooksSidebar ?? scheduleContext?.onCloseWebhooksSidebar,
  };
}
