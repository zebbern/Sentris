import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { KeyRound, RefreshCw } from 'lucide-react';
import { PageToolbar } from '@/components/shared/PageToolbar';
import { DndContext, type CollisionDetection, type SensorDescriptor } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableTableRow } from '@/components/ui/sortable';
import { BulkActionBar } from '@/components/ui/bulk-action-bar';
import type { SecretSummary } from '@/schemas/secret';
import { cn } from '@/lib/utils';
import { SecretRow } from './SecretRow';
import type { DragEndEvent } from '@dnd-kit/core';

export interface SecretsTableProps {
  secrets: SecretSummary[];
  loading: boolean;
  error: string | null;
  isReadOnly: boolean;

  // Refresh
  onRefresh: () => void;

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
  onBulkDelete: () => void;

  // Row actions
  onEdit: (secret: SecretSummary) => void;
  onDelete: (secret: SecretSummary) => void;
}

function TableSkeleton() {
  return (
    <div className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
      <Table>
        <TableHeader>
          <TableRow className="text-muted-foreground">
            <TableHead className="min-w-[120px]">Name</TableHead>
            <TableHead className="min-w-[100px] hidden sm:table-cell">Tags</TableHead>
            <TableHead className="min-w-[120px] hidden md:table-cell">Active Version</TableHead>
            <TableHead className="min-w-[100px] hidden lg:table-cell">Updated</TableHead>
            <TableHead className="text-right min-w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 4 }).map((_, idx) => (
            <TableRow key={`skeleton-${idx}`}>
              <TableCell>
                <Skeleton className="h-4 w-[120px]" />
                <Skeleton className="h-3 w-[80px] mt-1" />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <div className="flex gap-1">
                  <Skeleton className="h-5 w-[50px]" />
                  <Skeleton className="h-5 w-[40px]" />
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Skeleton className="h-4 w-[60px]" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="h-4 w-[100px]" />
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Skeleton className="h-8 w-[50px]" />
                  <Skeleton className="h-8 w-[60px]" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SecretsTable({
  secrets,
  loading,
  error,
  isReadOnly,
  onRefresh,
  sensors,
  collisionDetection,
  onDragEnd,
  selectedIds,
  toggleId,
  toggleAll,
  isAllSelected,
  isIndeterminate,
  selectedCount,
  onBulkDelete,
  onEdit,
  onDelete,
}: SecretsTableProps) {
  return (
    <div className="border rounded-lg bg-card p-4 md:p-6">
      <PageToolbar
        filters={
          <div>
            <h2 className="text-lg md:text-xl font-semibold">Stored secrets</h2>
            <p className="text-xs md:text-sm text-muted-foreground">
              Only metadata is shown. Use the Secret Fetch component or parameter selectors to
              reference a secret.
            </p>
          </div>
        }
        actions={
          <Button variant="outline" onClick={onRefresh} disabled={loading} className="gap-2">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
        className="sm:flex-row sm:items-center justify-between gap-3 mb-4"
      />

      {error && <ErrorBanner message={error} onRetry={onRefresh} className="mb-4" />}

      {loading && secrets.length === 0 ? (
        <TableSkeleton />
      ) : secrets.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No secrets yet"
          description="Store and manage sensitive values like API keys, credentials, and tokens for use in workflows."
          className="py-12"
        />
      ) : (
        <div className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
          <BulkActionBar
            selectedCount={selectedCount}
            actions={[
              {
                label: `Delete selected (${selectedCount})`,
                onClick: onBulkDelete,
                variant: 'destructive',
              },
            ]}
          />
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={onDragEnd}
          >
            <Table className="table-fixed w-full" aria-label="Stored secrets">
              <TableHeader>
                <TableRow className="text-muted-foreground">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={isAllSelected || (isIndeterminate && 'indeterminate')}
                      onCheckedChange={toggleAll}
                      aria-label="Select all secrets"
                    />
                  </TableHead>
                  <TableHead className="w-10" />
                  <TableHead className="min-w-[120px]">Name</TableHead>
                  <TableHead className="min-w-[100px] hidden sm:table-cell">Tags</TableHead>
                  <TableHead className="min-w-[120px] hidden md:table-cell">
                    Active Version
                  </TableHead>
                  <TableHead className="min-w-[100px] hidden lg:table-cell">Updated</TableHead>
                  <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableContext
                  items={secrets.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {secrets.map((secret) => (
                    <SortableTableRow
                      key={secret.id}
                      id={secret.id}
                      data-state={selectedIds.has(secret.id) ? 'selected' : undefined}
                    >
                      {({ handleProps }) => (
                        <SecretRow
                          secret={secret}
                          handleProps={handleProps}
                          isSelected={selectedIds.has(secret.id)}
                          onToggle={() => toggleId(secret.id)}
                          isReadOnly={isReadOnly}
                          onEdit={onEdit}
                          onDelete={onDelete}
                        />
                      )}
                    </SortableTableRow>
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          </DndContext>
        </div>
      )}
    </div>
  );
}
