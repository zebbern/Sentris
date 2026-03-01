import { useState, useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { WorkflowSchedule } from '@sentris/shared';
import type { ToastContextValue } from '@/components/ui/toast-context';
import type { ConfirmDialogOptions } from '@/hooks/useConfirmDialog';
import { queryKeys } from '@/lib/queryKeys';
import { humanizeApiError } from '@/lib/humanizeApiError';

interface MutationLike {
  mutateAsync: (id: string) => Promise<unknown>;
}

interface UseScheduleActionsOptions {
  pauseMutation: MutationLike;
  resumeMutation: MutationLike;
  runMutation: MutationLike;
  deleteMutation: MutationLike;
  toast: ToastContextValue['toast'];
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  queryClient: QueryClient;
}

export function useScheduleActions({
  pauseMutation,
  resumeMutation,
  runMutation,
  deleteMutation,
  toast,
  confirm,
  queryClient,
}: UseScheduleActionsOptions) {
  const [actionState, setActionState] = useState<Record<string, 'run' | 'toggle'>>({});

  const markAction = useCallback((id: string, action: 'run' | 'toggle') => {
    setActionState((prev) => ({ ...prev, [id]: action }));
  }, []);

  const clearAction = useCallback((id: string) => {
    setActionState((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const handlePauseResume = useCallback(
    async (schedule: WorkflowSchedule) => {
      markAction(schedule.id, 'toggle');
      try {
        if (schedule.status === 'active') {
          await pauseMutation.mutateAsync(schedule.id);
          toast({
            title: 'Schedule paused',
            description: `"${schedule.name}" has been paused.`,
          });
        } else {
          await resumeMutation.mutateAsync(schedule.id);
          toast({
            title: 'Schedule resumed',
            description: `"${schedule.name}" is active again.`,
          });
        }
      } catch {
        // Global MutationCache error handler shows the toast
      } finally {
        clearAction(schedule.id);
      }
    },
    [pauseMutation, resumeMutation, toast, markAction, clearAction],
  );

  const handleRunNow = useCallback(
    async (schedule: WorkflowSchedule) => {
      markAction(schedule.id, 'run');
      try {
        await runMutation.mutateAsync(schedule.id);
        toast({
          title: 'Run requested',
          description: `Scheduled cadence "${schedule.name}" is executing now.`,
        });
      } catch {
        // Global MutationCache error handler shows the toast
      } finally {
        clearAction(schedule.id);
      }
    },
    [runMutation, toast, markAction, clearAction],
  );

  const handleRefresh = useCallback(async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.schedules.root() });
      toast({
        title: 'Schedules refreshed',
        description: 'Latest schedule statuses have been loaded.',
      });
    } catch (err: unknown) {
      toast({
        title: 'Refresh failed',
        description: humanizeApiError(err),
        variant: 'destructive',
      });
    }
  }, [queryClient, toast]);

  const handleDelete = useCallback(
    async (schedule: WorkflowSchedule) => {
      const ok = await confirm({
        title: 'Delete schedule',
        description: `Are you sure you want to delete "${schedule.name}"? This action cannot be undone.`,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      markAction(schedule.id, 'run');
      try {
        await deleteMutation.mutateAsync(schedule.id);
        toast({
          title: 'Schedule deleted',
          description: `"${schedule.name}" has been deleted.`,
        });
      } catch {
        // Global MutationCache error handler shows the toast
      } finally {
        clearAction(schedule.id);
      }
    },
    [confirm, deleteMutation, toast, markAction, clearAction],
  );

  const isActionBusy = useCallback((id: string) => Boolean(actionState[id]), [actionState]);

  return {
    handlePauseResume,
    handleRunNow,
    handleRefresh,
    handleDelete,
    isActionBusy,
  };
}
