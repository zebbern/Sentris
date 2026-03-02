import { useMemo } from 'react';
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
import { Key, Plus, RefreshCw } from 'lucide-react';
import { PageToolbar } from '@/components/shared/PageToolbar';
import { DndContext, type CollisionDetection, type SensorDescriptor } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableTableRow } from '@/components/ui/sortable';
import { BulkActionBar } from '@/components/ui/bulk-action-bar';
import { cn } from '@/lib/utils';
import type { components } from '@sentris/backend-client';
import type { DragEndEvent } from '@dnd-kit/core';
import { ApiKeyRow } from './ApiKeyRow';

type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto'];

export interface ApiKeysTableProps {
  apiKeys: ApiKeyResponseDto[];
  orderedApiKeys: ApiKeyResponseDto[];
  loading: boolean;
  error: string | null;
  isReadOnly: boolean;

  // Search
  searchQuery: string;
  onSearchChange: (query: string) => void;

  // Create
  onCreateOpen: () => void;

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
  hasActiveSelected: boolean;
  onBulkRevoke: () => void;
  onBulkDelete: () => void;

  // Row actions
  onRevoke: (key: ApiKeyResponseDto) => void;
  onDelete: (key: ApiKeyResponseDto) => void;
}

function TableSkeleton() {
  return Array.from({ length: 4 }).map((_, idx) => (
    <TableRow key={`skeleton-${idx}`}>
      <TableCell>
        <Skeleton className="h-4 w-4" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-[120px]" />
        <Skeleton className="h-3 w-[80px] mt-1" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-[60px]" />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex gap-1">
          <Skeleton className="h-5 w-[70px]" />
          <Skeleton className="h-5 w-[50px]" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-[60px]" />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Skeleton className="h-4 w-[80px]" />
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <Skeleton className="h-4 w-[80px]" />
      </TableCell>
      <TableCell className="text-right">
        <Skeleton className="h-8 w-8 ml-auto" />
      </TableCell>
    </TableRow>
  ));
}

export function ApiKeysTable({
  apiKeys,
  orderedApiKeys,
  loading,
  error,
  isReadOnly,
  searchQuery,
  onSearchChange,
  onCreateOpen,
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
  hasActiveSelected,
  onBulkRevoke,
  onBulkDelete,
  onRevoke,
  onDelete,
}: ApiKeysTableProps) {
  const filteredApiKeys = useMemo(() => {
    if (!searchQuery.trim()) return orderedApiKeys;
    const q = searchQuery.toLowerCase();
    return orderedApiKeys.filter(
      (k) => k.name.toLowerCase().includes(q) || k.description?.toLowerCase().includes(q),
    );
  }, [orderedApiKeys, searchQuery]);

  return (
    <>
      <PageToolbar
        title="API Keys"
        searchValue={searchQuery}
        onSearchChange={onSearchChange}
        searchPlaceholder="Filter by name..."
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={onCreateOpen}
              disabled={isReadOnly}
              className="self-start sm:self-auto gap-2"
            >
              <Plus className="h-4 w-4" />
              Create new key
            </Button>
            <Button variant="outline" onClick={onRefresh} disabled={loading} className="gap-2">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        }
        className="sm:flex-row sm:items-center justify-between gap-4 mb-4 md:mb-8"
      />

      {error && <ErrorBanner message={error} onRetry={onRefresh} className="mb-4 md:mb-6" />}

      <div className="border rounded-md bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <BulkActionBar
            selectedCount={selectedCount}
            actions={[
              ...(hasActiveSelected
                ? [
                    {
                      label: 'Revoke selected',
                      onClick: onBulkRevoke,
                      variant: 'default' as const,
                    },
                  ]
                : []),
              {
                label: `Delete selected (${selectedCount})`,
                onClick: onBulkDelete,
                variant: 'destructive' as const,
              },
            ]}
            className="mx-2 mt-2"
          />
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={onDragEnd}
          >
            <Table className="table-fixed w-full" aria-label="API keys">
              {(apiKeys.length > 0 || loading) && (
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={isAllSelected || (isIndeterminate && 'indeterminate')}
                        onCheckedChange={toggleAll}
                        aria-label="Select all API keys"
                      />
                    </TableHead>
                    <TableHead className="w-10" />
                    <TableHead className="min-w-[120px]">Name</TableHead>
                    <TableHead className="min-w-[80px]">Key Hint</TableHead>
                    <TableHead className="min-w-[120px] hidden md:table-cell">
                      Permissions
                    </TableHead>
                    <TableHead className="min-w-[80px]">Status</TableHead>
                    <TableHead className="min-w-[100px] hidden sm:table-cell">Created</TableHead>
                    <TableHead className="min-w-[100px] hidden lg:table-cell">Last Used</TableHead>
                    <TableHead className="text-right min-w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
              )}
              <TableBody>
                {loading && apiKeys.length === 0 ? (
                  <TableSkeleton />
                ) : error && apiKeys.length === 0 ? null : apiKeys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <EmptyState
                        icon={Key}
                        title="No API keys"
                        description="Create your first API key to enable programmatic access."
                        className="py-10"
                        action={
                          !isReadOnly ? (
                            <Button onClick={onCreateOpen} className="gap-2">
                              <Plus className="h-4 w-4" />
                              Create new key
                            </Button>
                          ) : undefined
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : filteredApiKeys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <EmptyState
                        icon={Key}
                        title="No matching keys"
                        description="No API keys match your search query."
                        className="py-10"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  <SortableContext
                    items={filteredApiKeys.map((k) => k.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {filteredApiKeys.map((key) => (
                      <SortableTableRow
                        key={key.id}
                        id={key.id}
                        data-state={selectedIds.has(key.id) ? 'selected' : undefined}
                      >
                        {({ handleProps }) => (
                          <ApiKeyRow
                            apiKey={key}
                            handleProps={handleProps}
                            isSelected={selectedIds.has(key.id)}
                            isReadOnly={isReadOnly}
                            onToggle={() => toggleId(key.id)}
                            onRevoke={onRevoke}
                            onDelete={onDelete}
                          />
                        )}
                      </SortableTableRow>
                    ))}
                  </SortableContext>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>
      </div>
    </>
  );
}
