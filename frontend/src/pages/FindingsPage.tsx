import { useMemo, useState, useCallback } from 'react';
import { ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageToolbar } from '@/components/shared/PageToolbar';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useFindingsQuery, type FindingItem } from '@/hooks/queries/useFindingsQueries';
import { useDebounce } from '@/hooks/useDebounce';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'info', label: 'Info' },
];

const PAGE_SIZE = 25;

type BadgeVariant = 'destructive' | 'warning' | 'default' | 'secondary' | 'outline';

const SEVERITY_BADGE_MAP: Record<string, { variant: BadgeVariant; label: string }> = {
  critical: { variant: 'destructive', label: 'Critical' },
  high: { variant: 'destructive', label: 'High' },
  medium: { variant: 'warning', label: 'Medium' },
  low: { variant: 'default', label: 'Low' },
  info: { variant: 'secondary', label: 'Info' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity?: string }) {
  const normalised = severity?.toLowerCase() ?? 'unknown';
  const config = SEVERITY_BADGE_MAP[normalised] ?? {
    variant: 'outline' as const,
    label: severity ?? 'Unknown',
  };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function FindingsTableSkeleton() {
  return (
    <div aria-busy="true" className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function FindingsEmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <ShieldAlert className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold">No findings found</h3>
      <p className="text-sm text-muted-foreground mt-1">
        {hasFilters
          ? 'Try adjusting your filters or search query.'
          : 'Security findings will appear here once your workflows produce results.'}
      </p>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function truncate(value: string | undefined, max = 40): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FindingsPage() {
  useDocumentTitle('Findings');

  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('all');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  // Reset page when filters change
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleSeverityChange = useCallback((value: string) => {
    setSeverity(value);
    setPage(1);
  }, []);

  const queryParams = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      severity: severity !== 'all' ? severity : undefined,
      search: debouncedSearch || undefined,
    }),
    [page, severity, debouncedSearch],
  );

  const { data, isLoading, error, refetch } = useFindingsQuery(queryParams);

  const items: FindingItem[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasFilters = severity !== 'all' || debouncedSearch.length > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar
        title="Findings"
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder="Search findings by name, asset, workflow…"
        filters={
          <Select value={severity} onValueChange={handleSeverityChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* Error */}
      {error && (
        <ErrorBanner
          message={error.message ?? 'Failed to load findings'}
          onRetry={() => refetch()}
        />
      )}

      {/* Loading */}
      {isLoading && items.length === 0 && <FindingsTableSkeleton />}

      {/* Empty */}
      {!isLoading && !error && items.length === 0 && <FindingsEmptyState hasFilters={hasFilters} />}

      {/* Table */}
      {items.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Timestamp</TableHead>
                  <TableHead className="w-[100px]">Severity</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="w-[120px]">Run ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((finding) => (
                  <TableRow key={finding.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(finding.timestamp)}
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={finding.severity} />
                    </TableCell>
                    <TableCell className="font-medium">{truncate(finding.name, 60)}</TableCell>
                    <TableCell className="text-sm">{truncate(finding.asset_key)}</TableCell>
                    <TableCell className="text-sm">{truncate(finding.workflow_name)}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {finding.run_id ? finding.run_id.slice(0, 8) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
