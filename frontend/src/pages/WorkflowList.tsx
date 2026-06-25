import { useNavigate } from 'react-router-dom';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { DOCS_URLS } from '@/config/docs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Workflow, Info, Download } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/error-banner';
import { type WorkflowSummary } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { track, Events } from '@/features/analytics/events';
import {
  useWorkflowsSummary,
  useDeleteWorkflow,
  useCloneWorkflow,
} from '@/hooks/queries/useWorkflowQueries';
import { useWorkflowTags, useSetWorkflowTags } from '@/hooks/queries/useWorkflowTagQueries';
import { TagFilter } from '@/components/shared/TagFilter';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { exportTableData, type ExportColumn } from '@/lib/exportTableData';
import { logger } from '@/lib/logger';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortableList } from '@/hooks/useSortableList';
import { useToast } from '@/components/ui/use-toast';
import { WorkflowRow } from './WorkflowRow';

// Stable reference to avoid creating a new [] on every render when query data is undefined.
const EMPTY_WORKFLOWS: WorkflowSummary[] = [];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];

const WORKFLOW_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'description', header: 'Description' },
  { key: 'runCount', header: 'Run Count' },
  { key: 'latestRunStatus', header: 'Latest Run Status' },
  { key: 'lastRun', header: 'Last Run' },
  { key: 'nodeCount', header: 'Node Count' },
  { key: 'createdAt', header: 'Created At' },
  { key: 'updatedAt', header: 'Updated At' },
  { key: 'id', header: 'Workflow ID' },
];

export function WorkflowList() {
  useDocumentTitle('Workflows');
  const navigate = useNavigate();
  const { toast } = useToast();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const {
    data: rawWorkflows = EMPTY_WORKFLOWS,
    isLoading,
    error,
    refetch,
  } = useWorkflowsSummary(selectedTags.length > 0 ? selectedTags : undefined);
  const trackedRef = useRef(false);

  const roles = useAuthStore((state) => state.roles);
  const organizationId = useAuthStore((state) => state.organizationId);
  const canManageWorkflows = hasAdminRole(roles);
  const isReadOnly = !canManageWorkflows;
  const { confirm, dialogProps } = useConfirmDialog();
  const deleteWorkflow = useDeleteWorkflow();
  const cloneWorkflow = useCloneWorkflow();

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Tag data
  const { data: allTags = [], isLoading: isTagsLoading } = useWorkflowTags();
  const setWorkflowTags = useSetWorkflowTags();

  // Track first view
  if (rawWorkflows.length > 0 && !trackedRef.current) {
    track(Events.WorkflowListViewed, { workflows_count: rawWorkflows.length });
    trackedRef.current = true;
  }

  // Client-side filtering
  const filteredWorkflows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rawWorkflows.filter((w) => {
      const matchesSearch =
        query.length === 0 ||
        w.name.toLowerCase().includes(query) ||
        (w.description?.toLowerCase().includes(query) ?? false);
      const matchesStatus =
        statusFilter === 'all' || w.latestRunStatus?.toLowerCase() === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rawWorkflows, searchQuery, statusFilter]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 || statusFilter !== 'all' || selectedTags.length > 0;

  // DnD via shared hook
  const getWorkflowId = useCallback((w: WorkflowSummary) => w.id, []);

  const {
    orderedItems: orderedWorkflows,
    sensors,
    collisionDetection,
    handleDragEnd,
    isDragDisabled,
  } = useSortableList({
    items: filteredWorkflows,
    getId: getWorkflowId,
    storageKey: `sentris:sort:workflows:${organizationId}`,
    disabled: hasActiveFilters,
  });

  const handleDeleteClick = async (event: MouseEvent, workflow: WorkflowSummary) => {
    event.stopPropagation();
    if (!canManageWorkflows) return;

    const ok = await confirm({
      title: 'Delete workflow',
      description: `This action permanently removes "${workflow.name}" and its configuration. Runs and logs remain available for auditing purposes.`,
      confirmLabel: 'Delete workflow',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!ok) return;

    try {
      await deleteWorkflow.mutateAsync(workflow.id);
    } catch (err: unknown) {
      logger.error('Failed to delete workflow:', err);
      // Global MutationCache error handler shows the toast
    }
  };

  const handleCloneClick = async (event: MouseEvent, workflow: WorkflowSummary) => {
    event.stopPropagation();
    if (!canManageWorkflows) return;

    try {
      const newWorkflow = await cloneWorkflow.mutateAsync(workflow.id);
      track(Events.WorkflowDuplicated, {
        source_workflow_id: workflow.id,
        new_workflow_id: newWorkflow.id,
      });
      toast({
        title: 'Workflow duplicated',
        description: `"${newWorkflow.name}" has been created.`,
      });
    } catch (err: unknown) {
      logger.error('Failed to clone workflow:', err);
      // Global MutationCache error handler shows the toast
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short',
    }).format(date);
  };

  const handleCreateWorkflow = () => {
    if (!canManageWorkflows) {
      return;
    }
    track(Events.WorkflowCreateClicked, {});
    navigate('/workflows/new');
  };

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4 space-y-4 md:space-y-6">
        {isReadOnly && (
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-muted-foreground">
            You are viewing workflows with read-only access. Administrators can create and edit
            workflows.
          </div>
        )}

        {/* Filters */}
        <PageToolbar
          helpUrl={DOCS_URLS.userGuide}
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchLabel="Search workflows"
          searchPlaceholder="Filter by name or description"
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={filteredWorkflows.length === 0}
                  aria-label="Export workflows"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    exportTableData<WorkflowSummary>({
                      data: filteredWorkflows,
                      columns: WORKFLOW_EXPORT_COLUMNS,
                      filename: 'workflows',
                      format: 'csv',
                    })
                  }
                >
                  Download CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    exportTableData<WorkflowSummary>({
                      data: filteredWorkflows,
                      columns: WORKFLOW_EXPORT_COLUMNS,
                      filename: 'workflows',
                      format: 'json',
                    })
                  }
                >
                  Download JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
          filters={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TagFilter
                availableTags={allTags}
                selectedTags={selectedTags}
                onSelectedTagsChange={setSelectedTags}
                isLoading={isTagsLoading}
              />
            </div>
          }
        />

        {error ? (
          <ErrorBanner
            message={error?.message ?? 'Failed to load workflows'}
            onRetry={() => refetch()}
            className="mb-6"
          />
        ) : isLoading ? (
          <div className="border rounded-lg bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="table-fixed w-full" aria-label="Workflows">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 hidden sm:table-cell" />
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Nodes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-1 cursor-help">
                              Last Run
                              <Info className="h-3 w-3 text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Times shown in your local timezone</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                    <TableHead className="hidden lg:table-cell whitespace-nowrap">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-1 cursor-help">
                              Last Updated
                              <Info className="h-3 w-3 text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Times shown in your local timezone</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                    {canManageWorkflows && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="w-10 px-2 hidden sm:table-cell">
                        <Skeleton className="h-4 w-4 bg-muted" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-[220px] bg-muted" />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Skeleton className="h-5 w-[80px] bg-muted" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-[80px] bg-muted" />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Skeleton className="h-4 w-[160px] bg-muted" />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Skeleton className="h-4 w-[160px] bg-muted" />
                      </TableCell>
                      {canManageWorkflows && (
                        <TableCell className="text-right">
                          <Skeleton className="h-8 w-8 ml-auto rounded-md bg-muted" />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : orderedWorkflows.length === 0 ? (
          <div className="border rounded-lg bg-card">
            <EmptyState
              icon={Workflow}
              title={hasActiveFilters ? 'No matching workflows' : 'No workflows yet'}
              description={
                hasActiveFilters
                  ? 'Try adjusting your search or filter criteria'
                  : 'Create your first workflow to get started'
              }
              action={
                hasActiveFilters ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                      setSelectedTags([]);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={handleCreateWorkflow} disabled={isReadOnly} size="default">
                    Create Workflow
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="border rounded-lg bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragEnd={handleDragEnd}
              >
                <Table className="table-fixed w-full" aria-label="Workflows">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 hidden sm:table-cell" />
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden sm:table-cell">Nodes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="min-w-[140px] hidden md:table-cell">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 cursor-help">
                                Last Run
                                <Info className="h-3 w-3 text-muted-foreground" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Times shown in your local timezone</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      <TableHead className="min-w-[140px] hidden lg:table-cell whitespace-nowrap">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 cursor-help">
                                Last Updated
                                <Info className="h-3 w-3 text-muted-foreground" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Times shown in your local timezone</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableHead>
                      {canManageWorkflows && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <SortableContext
                      items={orderedWorkflows.map((w) => w.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {orderedWorkflows.map((workflow) => (
                        <WorkflowRow
                          key={workflow.id}
                          workflow={workflow}
                          canManageWorkflows={canManageWorkflows}
                          isDeleting={deleteWorkflow.isPending}
                          isCloning={cloneWorkflow.isPending}
                          isDragDisabled={isDragDisabled}
                          formatDate={formatDate}
                          onRowClick={() => navigate(`/workflows/${workflow.id}`)}
                          onDeleteClick={handleDeleteClick}
                          onCloneClick={handleCloneClick}
                          availableTags={allTags.map((t) => t.name)}
                          onTagsChange={(workflowId, tags) =>
                            setWorkflowTags.mutate({ workflowId, tags })
                          }
                          isTagsPending={setWorkflowTags.isPending}
                        />
                      ))}
                    </SortableContext>
                  </TableBody>
                </Table>
              </DndContext>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
