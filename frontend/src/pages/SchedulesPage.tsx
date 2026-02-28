import { useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageToolbar } from '@/components/shared/PageToolbar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Edit3,
  Plus,
  Trash2,
  CalendarClock,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { BulkActionBar } from '@/components/ui/bulk-action-bar';
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
import { queryKeys } from '@/lib/queryKeys';
import {
  ScheduleEditorDrawer,
  type WorkflowOption,
} from '@/components/schedules/ScheduleEditorDrawer';
import type { WorkflowSchedule } from '@shipsec/shared';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortableList } from '@/hooks/useSortableList';
import { SortableTableRow, DragHandle } from '@/components/ui/sortable';
import { useAuthStore } from '@/store/authStore';
import { formatDateTime } from '@/utils/timeFormat';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'error', label: 'Error' },
];

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  paused: 'secondary',
  error: 'destructive',
};

const getWorkflowName = (workflowId: string, workflows: WorkflowOption[]): string => {
  const match = workflows.find((workflow) => workflow.id === workflowId);
  return match?.name ?? 'Unknown workflow';
};

export function SchedulesPage() {
  useDocumentTitle('Schedules');
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionState, setActionState] = useState<Record<string, 'run' | 'toggle'>>({});
  const organizationId = useAuthStore((state) => state.organizationId);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [activeSchedule, setActiveSchedule] = useState<WorkflowSchedule | null>(null);

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
    storageKey: `shipsec:sort:schedules:${organizationId}`,
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

  const handleBulkPause = async () => {
    const ids = Array.from(selectedIds).filter((id) => {
      const schedule = orderedSchedules.find((s) => s.id === id);
      return schedule?.status === 'active';
    });
    if (ids.length === 0) return;

    const results = await Promise.allSettled(
      ids.map((id) => pauseScheduleMutation.mutateAsync(id)),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    clearSelection();

    if (failed === 0) {
      toast({ title: `Paused ${succeeded} schedule${succeeded !== 1 ? 's' : ''}` });
    } else {
      toast({
        title: 'Partial failure',
        description: `Paused ${succeeded} of ${ids.length} schedules (${failed} failed).`,
        variant: 'destructive',
      });
    }
  };

  const handleBulkResume = async () => {
    const ids = Array.from(selectedIds).filter((id) => {
      const schedule = orderedSchedules.find((s) => s.id === id);
      return schedule?.status === 'paused';
    });
    if (ids.length === 0) return;

    const results = await Promise.allSettled(
      ids.map((id) => resumeScheduleMutation.mutateAsync(id)),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    clearSelection();

    if (failed === 0) {
      toast({ title: `Resumed ${succeeded} schedule${succeeded !== 1 ? 's' : ''}` });
    } else {
      toast({
        title: 'Partial failure',
        description: `Resumed ${succeeded} of ${ids.length} schedules (${failed} failed).`,
        variant: 'destructive',
      });
    }
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

    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(
      ids.map((id) => deleteScheduleMutation.mutateAsync(id)),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    clearSelection();

    if (failed === 0) {
      toast({ title: `Deleted ${succeeded} schedule${succeeded !== 1 ? 's' : ''}` });
    } else {
      toast({
        title: 'Partial failure',
        description: `Deleted ${succeeded} of ${count} schedules (${failed} failed).`,
        variant: 'destructive',
      });
    }
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

  const markAction = (id: string, action: 'run' | 'toggle') => {
    setActionState((state) => ({ ...state, [id]: action }));
  };

  const clearAction = (id: string) => {
    setActionState((state) => {
      const { [id]: _removed, ...rest } = state;
      return rest;
    });
  };

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

  const openCreateDrawer = () => {
    setEditorMode('create');
    setActiveSchedule(null);
    setEditorOpen(true);
  };

  const openEditDrawer = (schedule: WorkflowSchedule) => {
    setEditorMode('edit');
    setActiveSchedule(schedule);
    setEditorOpen(true);
  };

  const handleScheduleSaved = (savedSchedule: WorkflowSchedule, mode: 'create' | 'edit') => {
    queryClient.invalidateQueries({ queryKey: queryKeys.schedules.root() });
    toast({
      title: mode === 'create' ? 'Schedule created' : 'Schedule updated',
      description:
        mode === 'create'
          ? `"${savedSchedule.name}" is now active.`
          : `"${savedSchedule.name}" has been updated.`,
    });
  };

  const handlePauseResume = async (schedule: WorkflowSchedule) => {
    markAction(schedule.id, 'toggle');
    try {
      if (schedule.status === 'active') {
        await pauseScheduleMutation.mutateAsync(schedule.id);
        toast({
          title: 'Schedule paused',
          description: `"${schedule.name}" has been paused.`,
        });
      } else {
        await resumeScheduleMutation.mutateAsync(schedule.id);
        toast({
          title: 'Schedule resumed',
          description: `"${schedule.name}" is active again.`,
        });
      }
    } catch (err: unknown) {
      toast({
        title: 'Schedule update failed',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      clearAction(schedule.id);
    }
  };

  const handleRunNow = async (schedule: WorkflowSchedule) => {
    markAction(schedule.id, 'run');
    try {
      await runScheduleMutation.mutateAsync(schedule.id);
      toast({
        title: 'Run requested',
        description: `Scheduled cadence "${schedule.name}" is executing now.`,
      });
    } catch (err: unknown) {
      toast({
        title: 'Failed to trigger schedule',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      clearAction(schedule.id);
    }
  };

  const handleRefresh = async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.schedules.root() });
      toast({
        title: 'Schedules refreshed',
        description: 'Latest schedule statuses have been loaded.',
      });
    } catch (err: unknown) {
      toast({
        title: 'Refresh failed',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    }
  };

  const handleEdit = (schedule: WorkflowSchedule) => {
    openEditDrawer(schedule);
  };

  const handleDelete = async (schedule: WorkflowSchedule) => {
    const ok = await confirm({
      title: 'Delete schedule',
      description: `Are you sure you want to delete "${schedule.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    markAction(schedule.id, 'run');
    try {
      await deleteScheduleMutation.mutateAsync(schedule.id);
      toast({
        title: 'Schedule deleted',
        description: `"${schedule.name}" has been deleted.`,
      });
    } catch (err: unknown) {
      toast({
        title: 'Failed to delete schedule',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      clearAction(schedule.id);
    }
  };

  const isActionBusy = (id: string) => Boolean(actionState[id]);

  const renderStatusBadge = (status: string) => {
    const variant = STATUS_VARIANTS[status] || 'outline';
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return <Badge variant={variant}>{label}</Badge>;
  };

  const hasData = orderedSchedules.length > 0;

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

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs uppercase text-muted-foreground">Status</label>
              <Select value={filters.status} onValueChange={handleStatusFilterChange}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase text-muted-foreground">Workflow</label>
              <Select
                value={filters.workflowId ?? 'all'}
                onValueChange={handleWorkflowFilterChange}
                disabled={workflowsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All workflows" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All workflows</SelectItem>
                  {workflowOptions.map((workflow) => (
                    <SelectItem key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <BulkActionBar selectedCount={selectedCount} actions={bulkActions} />
              <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragEnd={handleDragEnd}
              >
                <Table className="table-fixed w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={isAllSelected || (isIndeterminate && 'indeterminate')}
                          onCheckedChange={toggleAll}
                          aria-label="Select all schedules"
                        />
                      </TableHead>
                      <TableHead className="w-10" />
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden md:table-cell">Workflow</TableHead>
                      <TableHead className="hidden lg:table-cell">Cadence</TableHead>
                      <TableHead className="hidden sm:table-cell">Next run</TableHead>
                      <TableHead className="hidden lg:table-cell">Last run</TableHead>
                      <TableHead className="hidden sm:table-cell">Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && !hasData
                      ? Array.from({ length: 4 }).map((_, index) => (
                          <TableRow key={`skeleton-${index}`}>
                            <TableCell>
                              <Skeleton className="h-4 w-4" />
                            </TableCell>
                            {Array.from({ length: 8 }).map((_, cell) => (
                              <TableCell key={`cell-${cell}`}>
                                <Skeleton className="h-5 w-full" />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      : null}
                    {!isLoading && hasData ? (
                      <SortableContext
                        items={orderedSchedules.map((s) => s.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {orderedSchedules.map((schedule) => {
                          const workflowName = getWorkflowName(
                            schedule.workflowId,
                            workflowOptions,
                          );
                          const cadenceLabel = schedule.humanLabel
                            ? `${schedule.humanLabel} (${schedule.cronExpression})`
                            : schedule.cronExpression;

                          const isPaused = schedule.status !== 'active';

                          return (
                            <SortableTableRow
                              key={schedule.id}
                              id={schedule.id}
                              disabled={isDragDisabled}
                              data-state={selectedIds.has(schedule.id) ? 'selected' : undefined}
                            >
                              {({ handleProps }) => (
                                <>
                                  <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                                    <Checkbox
                                      checked={selectedIds.has(schedule.id)}
                                      onCheckedChange={() => toggleId(schedule.id)}
                                      aria-label={`Select ${schedule.name}`}
                                    />
                                  </TableCell>
                                  <DragHandle {...handleProps} disabled={isDragDisabled} />
                                  <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                      <span className="truncate max-w-[120px] md:max-w-none">
                                        {schedule.name}
                                      </span>
                                      {schedule.description && (
                                        <span className="text-xs text-muted-foreground truncate max-w-[120px] md:max-w-none">
                                          {schedule.description}
                                        </span>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="hidden md:table-cell">
                                    <div className="flex flex-col">
                                      <span className="font-medium truncate max-w-[120px]">
                                        {workflowName}
                                      </span>
                                      <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                                        {schedule.workflowId}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="hidden lg:table-cell">
                                    <div className="flex flex-col">
                                      <span className="text-sm">{cadenceLabel}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {schedule.timezone}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-sm hidden sm:table-cell whitespace-nowrap">
                                    {formatDateTime(schedule.nextRunAt)}
                                  </TableCell>
                                  <TableCell className="text-sm hidden lg:table-cell whitespace-nowrap">
                                    {formatDateTime(schedule.lastRunAt)}
                                  </TableCell>
                                  <TableCell className="hidden sm:table-cell whitespace-nowrap">
                                    {renderStatusBadge(schedule.status)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1 md:gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-1 h-8 px-2 md:px-3"
                                        onClick={() => handleRunNow(schedule)}
                                        disabled={isActionBusy(schedule.id)}
                                        aria-label={`Run ${schedule.name} now`}
                                      >
                                        <PlayCircle className="h-4 w-4" />
                                        <span className="hidden md:inline">Run</span>
                                      </Button>
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        className="gap-1 h-8 px-2 md:px-3"
                                        onClick={() => handlePauseResume(schedule)}
                                        disabled={isActionBusy(schedule.id)}
                                        aria-label={
                                          isPaused
                                            ? `Resume ${schedule.name}`
                                            : `Pause ${schedule.name}`
                                        }
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
                                            onClick={() => handleEdit(schedule)}
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
                                            onClick={() => handleDelete(schedule)}
                                            disabled={isActionBusy(schedule.id)}
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
                              )}
                            </SortableTableRow>
                          );
                        })}
                      </SortableContext>
                    ) : null}
                    {!isLoading && !hasData && (
                      <TableRow>
                        <TableCell colSpan={9}>
                          <EmptyState
                            icon={CalendarClock}
                            title="No schedules found"
                            description='Create your first cadence with the "New schedule" button or adjust the filters above.'
                            className="py-10"
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </DndContext>
            </div>
          </div>
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
        onClose={() => setEditorOpen(false)}
        onSaved={handleScheduleSaved}
      />
      <ConfirmDialog {...dialogProps} />
    </TooltipProvider>
  );
}
