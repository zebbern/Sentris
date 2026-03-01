import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/button';
import { BulkActionBar } from '@/components/ui/bulk-action-bar';
import { Link2, Plus } from 'lucide-react';
import { DndContext, type CollisionDetection, type SensorDescriptor } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableTableRow } from '@/components/ui/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import type { WebhookConfiguration } from '@sentris/shared';
import type { StatusBadgeProps } from '@/utils/tableHelpers';
import { WebhookRow } from './WebhookRow';

export interface WebhooksTableProps {
  orderedWebhooks: WebhookConfiguration[];
  isLoading: boolean;
  hasData: boolean;
  isDragDisabled: boolean;

  // DnD
  sensors: SensorDescriptor<Record<string, unknown>>[];
  collisionDetection: CollisionDetection;
  onDragEnd: (event: DragEndEvent) => void;

  // Bulk selection
  selectedIds: Set<string>;
  toggleId: (id: string) => void;
  toggleAll: () => void;
  isAllSelected: boolean;
  isIndeterminate: boolean;
  selectedCount: number;
  bulkActions: { label: string; onClick: () => void; variant?: 'default' | 'destructive' }[];

  // Per-row data resolvers
  getWorkflowName: (webhook: WebhookConfiguration) => string;
  getStatusBadgeProps: (webhook: WebhookConfiguration) => StatusBadgeProps;
  isActionBusy: (id: string) => boolean;

  // Row action handlers
  onNavigate: (webhook: WebhookConfiguration) => void;
  onCopyUrl: (webhook: WebhookConfiguration) => void;
  onViewHistory: (webhook: WebhookConfiguration) => void;
  onRegeneratePath: (webhook: WebhookConfiguration) => void;
  onDelete: (webhook: WebhookConfiguration) => void;

  // Empty state
  onCreateNew?: () => void;
}

function TableSkeleton() {
  return Array.from({ length: 4 }).map((_, index) => (
    <TableRow key={`skeleton-${index}`}>
      <TableCell>
        <Skeleton className="h-4 w-4" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-4" />
      </TableCell>
      {Array.from({ length: 6 }).map((_, cell) => (
        <TableCell key={`cell-${cell}`}>
          <Skeleton className="h-5 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

export function WebhooksTable({
  orderedWebhooks,
  isLoading,
  hasData,
  isDragDisabled,
  sensors,
  collisionDetection,
  onDragEnd,
  selectedIds,
  toggleId,
  toggleAll,
  isAllSelected,
  isIndeterminate,
  selectedCount,
  bulkActions,
  getWorkflowName,
  getStatusBadgeProps,
  isActionBusy,
  onNavigate,
  onCopyUrl,
  onViewHistory,
  onRegeneratePath,
  onDelete,
  onCreateNew,
}: WebhooksTableProps) {
  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <BulkActionBar selectedCount={selectedCount} actions={bulkActions} />
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
          <Table className="table-fixed w-full">
            {(hasData || isLoading) && (
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={isAllSelected || (isIndeterminate && 'indeterminate')}
                      onCheckedChange={toggleAll}
                      aria-label="Select all webhooks"
                    />
                  </TableHead>
                  <TableHead className="w-10" />
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Workflow</TableHead>
                  <TableHead className="hidden sm:table-cell">Webhook URL</TableHead>
                  <TableHead className="hidden lg:table-cell whitespace-nowrap">Created</TableHead>
                  <TableHead className="hidden sm:table-cell whitespace-nowrap">Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
            )}
            <TableBody>
              {isLoading && !hasData ? <TableSkeleton /> : null}
              {!isLoading && hasData ? (
                <SortableContext
                  items={orderedWebhooks.map((w) => w.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {orderedWebhooks.map((webhook) => (
                    <SortableTableRow
                      key={webhook.id}
                      id={webhook.id}
                      disabled={isDragDisabled}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => onNavigate(webhook)}
                      data-state={selectedIds.has(webhook.id) ? 'selected' : undefined}
                    >
                      {({ handleProps }) => (
                        <WebhookRow
                          webhook={webhook}
                          handleProps={handleProps}
                          isSelected={selectedIds.has(webhook.id)}
                          isDragDisabled={isDragDisabled}
                          workflowName={getWorkflowName(webhook)}
                          statusBadgeProps={getStatusBadgeProps(webhook)}
                          isActionBusy={isActionBusy(webhook.id)}
                          onToggle={() => toggleId(webhook.id)}
                          onCopyUrl={onCopyUrl}
                          onViewHistory={onViewHistory}
                          onRegeneratePath={onRegeneratePath}
                          onDelete={onDelete}
                        />
                      )}
                    </SortableTableRow>
                  ))}
                </SortableContext>
              ) : null}
              {!isLoading && !hasData && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState
                      icon={Link2}
                      title="No webhooks found"
                      description='Create your first webhook with the "New webhook" button or tweak the filters above.'
                      className="py-10"
                      action={
                        onCreateNew ? (
                          <Button onClick={onCreateNew} className="gap-2">
                            <Plus className="h-4 w-4" />
                            New webhook
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </DndContext>
      </div>
    </div>
  );
}
