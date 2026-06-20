import { useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PageToolbar } from '@/components/shared/PageToolbar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RefreshCw, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useBulkMutation } from '@/hooks/useBulkMutation';
import {
  useSchedules,
  usePauseSchedule,
  useResumeSchedule,
  useRunSchedule,
  useDeleteSchedule,
  type StatusFilter,
} from '@/hooks/queries/useScheduleQueries';
import { useWorkflowsSummary } from '@/hooks/queries/useWorkflowQueries';
import { useQueryClient } from '@tanstack/react-query';
import { ScheduleEditorDrawer } from '@/components/schedules/ScheduleEditorDrawer';
import type { WorkflowSchedule } from '@sentris/shared';
import { useSortableList } from '@/hooks/useSortableList';
import { useAuthStore } from '@/store/authStore';
import { getWorkflowName, getStatusBadgeProps } from '@/utils/tableHelpers';
import type { WorkflowOption, BadgeVariant } from '@/utils/tableHelpers';
import {
  SchedulesTable,
  ScheduleFilters,
  useScheduleActions,
  useScheduleEditorDrawer,
} from './schedules';

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  active: 'default',
  paused: 'secondary',
  error: 'destructive',
};

export function SchedulesPage() {
  useDocumentTitle('Schedules');
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const organizationId = useAuthStore((state) => state.organizationId);

  // Local filter state (search is client-side, workflowId & status go to the query)
  const initialWorkflowId = searchParams.get('workflowId') || null;
  const [filters, setFilters] = useState<{
    search: string;
    status: StatusFilter;
    workflowId: string | null;
  }>({ search: '', status: 'all', workflowId: initialWorkflowId });

  const {
    data: schedules = [],
    isLoading,
    error: schedulesError,
  } = useSchedules({
    workflowId: filters.workflowId,
    status: filters.status,
  });
  const error = schedulesError?.message ?? null;

  const { data: workflowsRaw = [], isLoading: workflowsLoading } = useWorkflowsSummary();
  const workflowOptions: WorkflowOption[] = useMemo(
    () => workflowsRaw.map((w) => ({ id: w.id, name: w.name ?? 'Untitled workflow' })),
    [workflowsRaw],
  );

  const pauseScheduleMutation = usePauseSchedule();
  const resumeScheduleMutation = useResumeSchedule();
  const runScheduleMutation = useRunSchedule();
  const deleteScheduleMutation = useDeleteSchedule();

  // --- Per-item action handlers ---
  const { handlePauseResume, handleRunNow, handleRefresh, handleDelete, isActionBusy } =
    useScheduleActions({
      pauseMutation: pauseScheduleMutation,
      resumeMutation: resumeScheduleMutation,
      runMutation: runScheduleMutation,
      deleteMutation: deleteScheduleMutation,
      toast,
      confirm,
      queryClient,
    });

  // --- Editor drawer state ---
  const {
    editorOpen,
    editorMode,
    activeSchedule,
    openCreateDrawer,
    openEditDrawer,
    closeDrawer,
    handleScheduleSaved,
  } = useScheduleEditorDrawer({ queryClient, toast });

  const filteredSchedules = useMemo(() => {
    const query = filters.search.trim().toLowerCase();

    return schedules.filter((schedule) => {
      const workflowName = getWorkflowName(schedule.workflowId, workflowOptions);
      const matchesSearch =
        query.length === 0 ||
        schedule.name.toLowerCase().includes(query) ||
        workflowName.toLowerCase().includes(query);

      return matchesSearch;
    });
  }, [filters.search, schedules, workflowOptions]);

  const hasActiveFilters =
    filters.search.trim().length > 0 || filters.status !== 'all' || filters.workflowId !== null;

  const getScheduleId = useCallback((s: WorkflowSchedule) => s.id, []);

  const {
    orderedItems: orderedSchedules,
    sensors,
    collisionDetection,
    handleDragEnd,
    isDragDisabled,
  } = useSortableList({
    items: filteredSchedules,
    getId: getScheduleId,
    storageKey: `sentris:sort:schedules:${organizationId}`,
    disabled: hasActiveFilters,
  });

  const {
    selectedIds,
    toggleId,
    toggleAll,
    clearSelection,
    isAllSelected,
    isIndeterminate,
    selectedCount,
  } = useBulkSelection(orderedSchedules);

  const executeBulkPause = useBulkMutation({
    mutateAsync: (id: string) => pauseScheduleMutation.mutateAsync(id),
    clearSelection,
    toast,
    messages: {
      successTitle: (n) => `Paused ${n} schedule${n !== 1 ? 's' : ''}`,
      successDescription: (n) =>
        `${n} schedule${n !== 1 ? 's' : ''} paused and will not trigger until resumed.`,
      partialDescription: (s, total, f) => `Paused ${s} of ${total} schedules (${f} failed).`,
    },
  });

  const executeBulkResume = useBulkMutation({
    mutateAsync: (id: string) => resumeScheduleMutation.mutateAsync(id),
    clearSelection,
    toast,
    messages: {
      successTitle: (n) => `Resumed ${n} schedule${n !== 1 ? 's' : ''}`,
      successDescription: (n) =>
        `${n} schedule${n !== 1 ? 's' : ''} resumed and will trigger on their next cron window.`,
      partialDescription: (s, total, f) => `Resumed ${s} of ${total} schedules (${f} failed).`,
    },
  });

  const executeBulkDelete = useBulkMutation({
    mutateAsync: (id: string) => deleteScheduleMutation.mutateAsync(id),
    clearSelection,
    toast,
    messages: {
      successTitle: (n) => `Deleted ${n} schedule${n !== 1 ? 's' : ''}`,
      successDescription: (n) => `${n} schedule${n !== 1 ? 's' : ''} permanently removed.`,
      partialDescription: (s, total, f) => `Deleted ${s} of ${total} schedules (${f} failed).`,
    },
  });

  const handleBulkPause = async () => {
    const ids = Array.from(selectedIds).filter((id) => {
      const schedule = orderedSchedules.find((s) => s.id === id);
      return schedule?.status === 'active';
    });
    if (ids.length === 0) return;
    await executeBulkPause(ids);
  };

  const handleBulkResume = async () => {
    const ids = Array.from(selectedIds).filter((id) => {
      const schedule = orderedSchedules.find((s) => s.id === id);
      return schedule?.status === 'paused';
    });
    if (ids.length === 0) return;
    await executeBulkResume(ids);
  };

  const handleBulkDelete = async () => {
    const count = selectedCount;
    const ok = await confirm({
      title: `Delete ${count} schedule${count !== 1 ? 's' : ''}`,
      description: `Are you sure you want to delete ${count} schedule${count !== 1 ? 's' : ''}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await executeBulkDelete(Array.from(selectedIds));
  };

  const bulkActions = useMemo(() => {
    const actions: { label: string; onClick: () => void; variant?: 'default' | 'destructive' }[] =
      [];
    const hasActiveSelected = Array.from(selectedIds).some((id) => {
      const schedule = orderedSchedules.find((s) => s.id === id);
      return schedule?.status === 'active';
    });
    const hasPausedSelected = Array.from(selectedIds).some((id) => {
      const schedule = orderedSchedules.find((s) => s.id === id);
      return schedule?.status === 'paused';
    });
    if (hasActiveSelected) {
      actions.push({ label: 'Pause selected', onClick: handleBulkPause });
    }
    if (hasPausedSelected) {
      actions.push({ label: 'Resume selected', onClick: handleBulkResume });
    }
    actions.push({ label: 'Delete selected', onClick: handleBulkDelete, variant: 'destructive' });
    return actions;
  }, [selectedIds, orderedSchedules]);

  const handleWorkflowFilterChange = (value: string) => {
    const workflowId = value === 'all' ? null : value;
    setFilters((prev) => ({ ...prev, workflowId }));
    const nextParams = new URLSearchParams(searchParams);
    if (workflowId) {
      nextParams.set('workflowId', workflowId);
    } else {
      nextParams.delete('workflowId');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleStatusFilterChange = (value: string) => {
    setFilters((prev) => ({ ...prev, status: value as typeof filters.status }));
  };

  const handleEdit = (schedule: WorkflowSchedule) => {
    openEditDrawer(schedule);
  };

  const hasData = orderedSchedules.length > 0;

  const getWorkflowNameForSchedule = useCallback(
    (s: WorkflowSchedule) => getWorkflowName(s.workflowId, workflowOptions),
    [workflowOptions],
  );

  const getCadenceLabel = useCallback(
    (s: WorkflowSchedule) =>
      s.humanLabel ? `${s.humanLabel} (${s.cronExpression})` : s.cronExpression,
    [],
  );

  const getStatusBadgePropsForSchedule = useCallback(
    (s: WorkflowSchedule) => getStatusBadgeProps(s.status, STATUS_VARIANTS),
    [],
  );

  return (
    <TooltipProvider>
      <div className="flex-1 bg-background" aria-busy={isLoading}>
        <div className="container mx-auto px-3 md:px-4 py-4 md:py-8 space-y-4 md:space-y-6">
          <PageToolbar
            searchValue={filters.search}
            onSearchChange={(value) => setFilters((prev) => ({ ...prev, search: value }))}
            searchLabel="Search schedules or workflows"
            searchPlaceholder="Filter by schedule or workflow"
            actions={
              <>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleRefresh}
                  disabled={isLoading}
                >
                  <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
                <Button variant="default" className="gap-2" onClick={openCreateDrawer}>
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">New schedule</span>
                </Button>
              </>
            }
          />

          {error && <ErrorBanner message={error} onRetry={handleRefresh} />}

          <ScheduleFilters
            status={filters.status}
            workflowId={filters.workflowId}
            workflowOptions={workflowOptions}
            workflowsLoading={workflowsLoading}
            onStatusChange={handleStatusFilterChange}
            onWorkflowChange={handleWorkflowFilterChange}
          />

          <SchedulesTable
            orderedSchedules={orderedSchedules}
            isLoading={isLoading}
            hasData={hasData}
            isDragDisabled={isDragDisabled}
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={handleDragEnd}
            selectedIds={selectedIds}
            toggleId={toggleId}
            toggleAll={toggleAll}
            isAllSelected={isAllSelected}
            isIndeterminate={isIndeterminate}
            selectedCount={selectedCount}
            bulkActions={bulkActions}
            getWorkflowName={getWorkflowNameForSchedule}
            getCadenceLabel={getCadenceLabel}
            getStatusBadgeProps={getStatusBadgePropsForSchedule}
            isActionBusy={isActionBusy}
            onRunNow={handleRunNow}
            onPauseResume={handlePauseResume}
            onEdit={handleEdit}
            onDelete={handleDelete}
            error={!!schedulesError}
            onCreateNew={openCreateDrawer}
          />
        </div>
      </div>
      <ScheduleEditorDrawer
        open={editorOpen}
        mode={editorMode}
        schedule={activeSchedule ?? undefined}
        defaultWorkflowId={
          editorMode === 'create' ? filters.workflowId : activeSchedule?.workflowId
        }
        workflowOptions={workflowOptions}
        onClose={closeDrawer}
        onSaved={handleScheduleSaved}
      />
      <ConfirmDialog {...dialogProps} />
    </TooltipProvider>
  );
}
