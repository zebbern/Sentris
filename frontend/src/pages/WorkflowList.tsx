import { useNavigate } from 'react-router-dom';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Workflow,
  AlertCircle,
  Trash2,
  Info,
  GripVertical,
  MoreHorizontal,
  Copy,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { type WorkflowSummary } from '@/services/api';
import { getStatusBadgeClassFromStatus, formatStatusText } from '@/utils/statusBadgeStyles';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { track, Events } from '@/features/analytics/events';
import {
  useWorkflowsSummary,
  useDeleteWorkflow,
  useCloneWorkflow,
} from '@/hooks/queries/useWorkflowQueries';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { logger } from '@/lib/logger';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSortableList } from '@/hooks/useSortableList';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';

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

export function WorkflowList() {
  useDocumentTitle('Workflows');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: rawWorkflows = EMPTY_WORKFLOWS, isLoading, error, refetch } = useWorkflowsSummary();
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

  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilter !== 'all';

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
    storageKey: `shipsec:sort:workflows:${organizationId}`,
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
      toast({
        title: 'Delete failed',
        description: 'Failed to delete workflow. Please try again.',
        variant: 'destructive',
      });
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
      toast({
        title: 'Duplicate failed',
        description: 'Failed to duplicate workflow. Please try again.',
        variant: 'destructive',
      });
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
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchLabel="Search workflows"
          searchPlaceholder="Filter by name or description"
          filters={
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
          }
        />

        {isLoading ? (
          <div className="border rounded-lg bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
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
                    <TableHead className="hidden lg:table-cell">
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
        ) : error ? (
          <div className="text-center py-12 border rounded-lg bg-card border-destructive">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h3 className="text-lg font-semibold mb-2">Failed to load workflows</h3>
            <p className="text-muted-foreground mb-4">{error?.message ?? 'Unknown error'}</p>
            <Button onClick={() => refetch()} variant="outline">
              Try Again
            </Button>
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
                <Table>
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
                      <TableHead className="min-w-[140px] hidden lg:table-cell">
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
                        <WorkflowRowItem
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

interface WorkflowRowItemProps {
  workflow: WorkflowSummary;
  canManageWorkflows: boolean;
  isDeleting: boolean;
  isCloning: boolean;
  isDragDisabled?: boolean;
  formatDate: (dateString: string) => string;
  onRowClick: () => void;
  onDeleteClick: (event: MouseEvent, workflow: WorkflowSummary) => void;
  onCloneClick: (event: MouseEvent, workflow: WorkflowSummary) => void;
}

function WorkflowRowItem({
  workflow,
  canManageWorkflows,
  isDeleting,
  isCloning,
  isDragDisabled = false,
  formatDate,
  onRowClick,
  onDeleteClick,
  onCloneClick,
}: WorkflowRowItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workflow.id,
    disabled: isDragDisabled,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  const nodeCount = workflow.nodeCount;

  const statusBadge = workflow.latestRunStatus ? (
    <Badge
      variant="outline"
      className={getStatusBadgeClassFromStatus(
        workflow.latestRunStatus,
        'text-xs whitespace-nowrap',
      )}
    >
      {formatStatusText(workflow.latestRunStatus)}
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className={getStatusBadgeClassFromStatus('NONE', 'text-xs whitespace-nowrap')}
    >
      {formatStatusText('NOT TRIGGERED')}
    </Badge>
  );

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      onClick={onRowClick}
      className={cn(
        'cursor-pointer transition-colors duration-150 hover:bg-accent/50 dark:hover:bg-accent/30',
        isDragging && 'bg-accent/50 shadow-lg',
      )}
    >
      <TableCell className="w-10 px-2 hidden sm:table-cell">
        {isDragDisabled ? (
          <div className="text-muted-foreground/30">
            <GripVertical className="h-4 w-4" />
          </div>
        ) : (
          <div
            className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}
      </TableCell>
      <TableCell className="font-medium">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="max-w-[200px] truncate">{workflow.name}</div>
            </TooltipTrigger>
            <TooltipContent>{workflow.name}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Badge variant="secondary" className="text-xs">
          {nodeCount}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">{statusBadge}</TableCell>
      <TableCell className="text-muted-foreground text-sm hidden md:table-cell">
        {workflow.lastRun ? formatDate(workflow.lastRun) : 'N/A'}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm hidden lg:table-cell">
        {formatDate(workflow.updatedAt)}
      </TableCell>
      {canManageWorkflows && (
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Actions for ${workflow.name}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => onCloneClick(e as unknown as MouseEvent, workflow)}
                disabled={isCloning}
              >
                <Copy className="mr-2 h-4 w-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => onDeleteClick(e as unknown as MouseEvent, workflow)}
                disabled={isDeleting}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      )}
    </TableRow>
  );
}
