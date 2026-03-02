import type { CSSProperties, MouseEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { GripVertical, MoreHorizontal, Copy, Trash2 } from 'lucide-react';
import { getStatusBadgeClassFromStatus, formatStatusText } from '@/utils/statusBadgeStyles';
import { type WorkflowSummary } from '@/services/api';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/shared/TagBadge';
import { TagEditor } from '@/components/shared/TagEditor';

export interface WorkflowRowProps {
  workflow: WorkflowSummary;
  canManageWorkflows: boolean;
  isDeleting: boolean;
  isCloning: boolean;
  isDragDisabled?: boolean;
  formatDate: (dateString: string) => string;
  onRowClick: () => void;
  onDeleteClick: (event: MouseEvent, workflow: WorkflowSummary) => void;
  onCloneClick: (event: MouseEvent, workflow: WorkflowSummary) => void;
  /** All available tag names for suggestions in the editor. */
  availableTags?: string[];
  /** Called with (workflowId, newTags) to update tags. */
  onTagsChange?: (workflowId: string, tags: string[]) => void;
  /** Whether a tag mutation is pending for this workflow. */
  isTagsPending?: boolean;
}

export function WorkflowRow({
  workflow,
  canManageWorkflows,
  isDeleting,
  isCloning,
  isDragDisabled = false,
  formatDate,
  onRowClick,
  onDeleteClick,
  onCloneClick,
  availableTags = [],
  onTagsChange,
  isTagsPending = false,
}: WorkflowRowProps) {
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
        {/* Tag badges */}
        {workflow.tags && workflow.tags.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-1 mt-1"
            onClick={(e) => e.stopPropagation()}
          >
            {workflow.tags.slice(0, 5).map((tag) => (
              <TagBadge key={tag} tag={tag} isActive className="text-[10px] px-1.5 py-0" />
            ))}
            {workflow.tags.length > 5 && (
              <span className="text-[10px] text-muted-foreground">
                +{workflow.tags.length - 5} more
              </span>
            )}
            {canManageWorkflows && onTagsChange && (
              <TagEditor
                currentTags={workflow.tags}
                availableTags={availableTags}
                onSave={(tags) => onTagsChange(workflow.id, tags)}
                isPending={isTagsPending}
              />
            )}
          </div>
        )}
        {/* Show add-tag button when no tags exist */}
        {(!workflow.tags || workflow.tags.length === 0) && canManageWorkflows && onTagsChange && (
          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <TagEditor
              currentTags={[]}
              availableTags={availableTags}
              onSave={(tags) => onTagsChange(workflow.id, tags)}
              isPending={isTagsPending}
            />
          </div>
        )}
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
