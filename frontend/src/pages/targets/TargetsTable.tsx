import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Target, Plus } from 'lucide-react';
import type { Scope } from '@/types/scopes';
import { TargetRow } from './TargetRow';

export interface TargetsTableProps {
  scopes: Scope[];
  isLoading: boolean;
  hasData: boolean;
  canManage: boolean;
  error?: boolean;
  onEdit: (scope: Scope) => void;
  onDelete: (scope: Scope) => void;
  onCreateNew?: () => void;
}

function TableSkeleton() {
  return Array.from({ length: 4 }).map((_, index) => (
    <TableRow key={`skeleton-${index}`}>
      {Array.from({ length: 4 }).map((_, cell) => (
        <TableCell key={`cell-${cell}`}>
          <Skeleton className="h-5 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

export function TargetsTable({
  scopes,
  isLoading,
  hasData,
  canManage,
  error,
  onEdit,
  onDelete,
  onCreateNew,
}: TargetsTableProps) {
  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="table-fixed w-full min-w-[480px]" aria-label="Targets">
          {(hasData || isLoading) && (
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase">Name</TableHead>
                <TableHead className="text-xs uppercase">Scope</TableHead>
                <TableHead className="text-xs uppercase whitespace-nowrap">Updated</TableHead>
                <TableHead className="text-right w-[132px] text-xs uppercase">Actions</TableHead>
              </TableRow>
            </TableHeader>
          )}
          <TableBody>
            {isLoading && !hasData ? <TableSkeleton /> : null}
            {!isLoading && hasData
              ? scopes.map((scope) => (
                  <TableRow key={scope.id}>
                    <TargetRow
                      scope={scope}
                      canManage={canManage}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  </TableRow>
                ))
              : null}
          </TableBody>
        </Table>
      </div>
      {!isLoading && !hasData && !error && (
        <EmptyState
          icon={Target}
          title="No targets yet"
          description="Create a target to save a scope you run templates against."
          className="py-10"
          action={
            canManage && onCreateNew ? (
              <Button onClick={onCreateNew} className="gap-2">
                <Plus className="h-4 w-4" />
                New target
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
