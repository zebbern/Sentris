import { Users } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useTopAssignees } from '@/hooks/queries/useTriageAnalyticsQueries';
import { EmptyAnalyticsState } from './EmptyAnalyticsState';

export function TopAssigneesTable() {
  const { data, isLoading, isError, error, refetch } = useTopAssignees(10);

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4" aria-busy="true">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Top Assignees</h3>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
        <span className="sr-only">Loading top assignees data</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Top Assignees</h3>
        </div>
        <ErrorBanner
          message={error?.message ?? 'Failed to load top assignees'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const assignees = data?.assignees ?? [];

  if (assignees.length === 0) {
    return (
      <div
        className="rounded-lg border bg-card p-4"
        role="img"
        aria-label="Top assignees table — no data available"
      >
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Top Assignees</h3>
        </div>
        <EmptyAnalyticsState message="No assignee data available" />
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border bg-card p-4"
      role="region"
      aria-label="Top assignees table ranking users by total findings"
    >
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Top Assignees</h3>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>User</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Resolved</TableHead>
            <TableHead className="text-right">Rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assignees.map((assignee, index) => (
            <TableRow key={assignee.userId ?? `unassigned-${index}`}>
              <TableCell className="font-medium text-muted-foreground">{index + 1}</TableCell>
              <TableCell>{assignee.userId ?? 'Unassigned'}</TableCell>
              <TableCell className="text-right">{assignee.totalCount}</TableCell>
              <TableCell className="text-right">{assignee.resolvedCount}</TableCell>
              <TableCell className="text-right">
                {assignee.resolutionRate != null ? `${assignee.resolutionRate.toFixed(1)}%` : 'N/A'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
