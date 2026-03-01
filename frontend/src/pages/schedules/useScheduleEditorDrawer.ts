import { useState, useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { WorkflowSchedule } from '@sentris/shared';
import type { ToastContextValue } from '@/components/ui/toast-context';
import { queryKeys } from '@/lib/queryKeys';

interface UseScheduleEditorDrawerOptions {
  queryClient: QueryClient;
  toast: ToastContextValue['toast'];
}

export function useScheduleEditorDrawer({ queryClient, toast }: UseScheduleEditorDrawerOptions) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [activeSchedule, setActiveSchedule] = useState<WorkflowSchedule | null>(null);

  const openCreateDrawer = useCallback(() => {
    setEditorMode('create');
    setActiveSchedule(null);
    setEditorOpen(true);
  }, []);

  const openEditDrawer = useCallback((schedule: WorkflowSchedule) => {
    setEditorMode('edit');
    setActiveSchedule(schedule);
    setEditorOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setEditorOpen(false);
  }, []);

  const handleScheduleSaved = useCallback(
    (savedSchedule: WorkflowSchedule, mode: 'create' | 'edit') => {
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.root() });
      toast({
        title: mode === 'create' ? 'Schedule created' : 'Schedule updated',
        description:
          mode === 'create'
            ? `"${savedSchedule.name}" is now active.`
            : `"${savedSchedule.name}" has been updated.`,
      });
    },
    [queryClient, toast],
  );

  return {
    editorOpen,
    editorMode,
    activeSchedule,
    openCreateDrawer,
    openEditDrawer,
    closeDrawer,
    handleScheduleSaved,
  };
}
