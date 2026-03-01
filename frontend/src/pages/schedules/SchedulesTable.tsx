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
import { BulkActionBar } from '@/components/ui/bulk-action-bar';
import { CalendarClock } from 'lucide-react';
import { DndContext, type CollisionDetection, type SensorDescriptor } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableTableRow } from '@/components/ui/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import type { WorkflowSchedule } from '@sentris/shared';
import type { StatusBadgeProps } from '@/utils/tableHelpers';
import { ScheduleRow } from './ScheduleRow';

export interface SchedulesTableProps {
  orderedSchedules: WorkflowSchedule[];
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
  getWorkflowName: (schedule: WorkflowSchedule) => string;
  getCadenceLabel: (schedule: WorkflowSchedule) => string;
  getStatusBadgeProps: (schedule: WorkflowSchedule) => StatusBadgeProps;
  isActionBusy: (id: string) => boolean;

  // Row action handlers
  onRunNow: (schedule: WorkflowSchedule) => void;
  onPauseResume: (schedule: WorkflowSchedule) => void;
  onEdit: (schedule: WorkflowSchedule) => void;
  onDelete: (schedule: WorkflowSchedule) => void;
}

function TableSkeleton() {
  return Array.from({ length: 4 }).map((_, index) => (
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
  ));
}

export function SchedulesTable({
  orderedSchedules,
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
  getCadenceLabel,
  getStatusBadgeProps,
  isActionBusy,
  onRunNow,
  onPauseResume,
  onEdit,
  onDelete,
}: SchedulesTableProps) {
  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <BulkActionBar selectedCount={selectedCount} actions={bulkActions} />
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
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
              {isLoading && !hasData ? <TableSkeleton /> : null}
              {!isLoading && hasData ? (
                <SortableContext
                  items={orderedSchedules.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {orderedSchedules.map((schedule) => (
                    <SortableTableRow
                      key={schedule.id}
                      id={schedule.id}
                      disabled={isDragDisabled}
                      data-state={selectedIds.has(schedule.id) ? 'selected' : undefined}
                    >
                      {({ handleProps }) => (
                        <ScheduleRow
                          schedule={schedule}
                          handleProps={handleProps}
                          isSelected={selectedIds.has(schedule.id)}
                          isDragDisabled={isDragDisabled}
                          workflowName={getWorkflowName(schedule)}
                          cadenceLabel={getCadenceLabel(schedule)}
                          statusBadgeProps={getStatusBadgeProps(schedule)}
                          isActionBusy={isActionBusy(schedule.id)}
                          onToggle={() => toggleId(schedule.id)}
                          onRunNow={onRunNow}
                          onPauseResume={onPauseResume}
                          onEdit={onEdit}
                          onDelete={onDelete}
                        />
                      )}
                    </SortableTableRow>
                  ))}
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
  );
}
