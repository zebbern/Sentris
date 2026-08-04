import { useMemo, useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldAlert, ChevronLeft, ChevronRight, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useFindingsQuery, type FindingItem } from '@/hooks/queries/useFindingsQueries';
import { useDebounce } from '@/hooks/useDebounce';
import { ExportButton } from '@/features/findings/ExportButton';
import { SeverityBadge } from '@/features/findings/SeverityBadge';
import { SeverityChart } from '@/features/findings/SeverityChart';
import { DateRangeFilter } from '@/features/findings/DateRangeFilter';
import { WorkflowFilter } from '@/features/findings/WorkflowFilter';
import { ToolFilter } from '@/features/findings/ToolFilter';
import { TriageStatusBadge } from '@/features/findings/TriageStatusBadge';
import { FindingsKanbanView } from '@/features/findings/FindingsKanbanView';
import { BulkActionsToolbar } from '@/features/findings/BulkActionsToolbar';
import { FINDING_TRIAGE_STATUSES, TRIAGE_STATUS_META } from '@/features/findings/types';
import {
  describeFindingDataQuality,
  shouldShowFindingDataQuality,
} from '@/features/findings/findingDataQuality';
import { parseFindingsView } from '@/pages/findings/findingsView';

const FindingDetailSheet = lazy(() =>
  import('@/features/findings/FindingDetailSheet').then((m) => ({
    default: m.FindingDetailSheet,
  })),
);

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
  { value: 'none', label: 'None' },
];

const PAGE_SIZE = 25;
const KANBAN_PAGE_SIZE = 100;
const MAX_SELECTION = 100;

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...FINDING_TRIAGE_STATUSES.map((s) => ({
    value: s,
    label: TRIAGE_STATUS_META[s].label,
  })),
];

const FILTER_TRIGGER_CLASS = 'w-full';

interface CursorNavigation {
  queryKey: string;
  page: number;
  cursors: (string | undefined)[];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

  // URL-driven view toggle and search (controls live in App top bar)
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = parseFindingsView(searchParams.get('view'));
  const search = searchParams.get('search') ?? '';
  const severityParam = searchParams.get('severity');
  const [severity, setSeverity] = useState(
    severityParam && severityParam !== 'all' ? severityParam : 'all',
  );
  const [triageStatus, setTriageStatus] = useState('all');
  const [cursorNavigation, setCursorNavigation] = useState<CursorNavigation>({
    queryKey: '',
    page: 1,
    cursors: [undefined],
  });
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date } | undefined>(undefined);
  const [workflowId, setWorkflowId] = useState<string | undefined>(undefined);
  const [componentId, setComponentId] = useState<string | undefined>(undefined);
  const scopeId = searchParams.get('scopeId') || undefined;
  const runId = searchParams.get('runId') || undefined;
  const selectedFindingId = searchParams.get('findingId');
  const selectFinding = useCallback(
    (findingId: string) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('findingId', findingId);
        return next;
      });
    },
    [setSearchParams],
  );
  const closeFinding = useCallback(() => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('findingId');
      return next;
    });
  }, [setSearchParams]);
  const clearRunFilter = useCallback(() => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('runId');
      return next;
    });
  }, [setSearchParams]);

  // Bulk selection (table view)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const debouncedSearch = useDebounce(search, 300);

  const handleSeverityChange = useCallback(
    (value: string) => {
      setSeverity(value);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'all') {
          next.delete('severity');
        } else {
          next.set('severity', value);
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const handleTriageStatusChange = useCallback((value: string) => {
    setTriageStatus(value);
  }, []);

  const handleDateRangeChange = useCallback((range: { from?: Date; to?: Date } | undefined) => {
    setDateRange(range);
  }, []);

  const handleWorkflowChange = useCallback((id: string | undefined) => {
    setWorkflowId(id);
  }, []);

  const handleComponentChange = useCallback((id: string | undefined) => {
    setComponentId(id);
  }, []);

  const paginationQueryKey = useMemo(
    () =>
      JSON.stringify({
        severity: severity !== 'all' ? severity : null,
        search: debouncedSearch || null,
        workflowId: workflowId ?? null,
        runId: runId ?? null,
        componentId: componentId ?? null,
        dateFrom: dateRange?.from?.toISOString() ?? null,
        dateTo: dateRange?.to?.toISOString() ?? null,
        triageStatus: triageStatus !== 'all' ? triageStatus : null,
        scopeId: scopeId ?? null,
        activeView,
      }),
    [
      severity,
      debouncedSearch,
      workflowId,
      runId,
      componentId,
      dateRange,
      triageStatus,
      scopeId,
      activeView,
    ],
  );
  const page = cursorNavigation.queryKey === paginationQueryKey ? cursorNavigation.page : 1;
  const cursor =
    cursorNavigation.queryKey === paginationQueryKey
      ? cursorNavigation.cursors[page - 1]
      : undefined;

  const queryParams = useMemo(
    () => ({
      page,
      pageSize: activeView === 'kanban' ? KANBAN_PAGE_SIZE : PAGE_SIZE,
      paginationMode: 'cursor' as const,
      cursor,
      severity: severity !== 'all' ? severity : undefined,
      search: debouncedSearch || undefined,
      workflowId,
      runId,
      componentId,
      dateFrom: dateRange?.from?.toISOString(),
      dateTo: dateRange?.to?.toISOString(),
      triageStatus: triageStatus !== 'all' ? triageStatus : undefined,
      scopeId,
    }),
    [
      page,
      severity,
      debouncedSearch,
      workflowId,
      runId,
      componentId,
      dateRange,
      triageStatus,
      activeView,
      scopeId,
      cursor,
    ],
  );

  const { data, isLoading, isPlaceholderData, error, refetch } = useFindingsQuery(queryParams);

  const items: FindingItem[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const activePageSize = activeView === 'kanban' ? KANBAN_PAGE_SIZE : PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / activePageSize));

  const handlePreviousPage = useCallback(() => {
    setCursorNavigation((previous) => ({
      queryKey: paginationQueryKey,
      page: Math.max(1, page - 1),
      cursors: previous.queryKey === paginationQueryKey ? previous.cursors : [undefined],
    }));
  }, [page, paginationQueryKey]);

  const handleNextPage = useCallback(() => {
    if (!data?.nextCursor) return;
    setCursorNavigation((previous) => {
      const cursors =
        previous.queryKey === paginationQueryKey ? [...previous.cursors] : [undefined];
      cursors[page - 1] = data.currentCursor ?? undefined;
      cursors[page] = data.nextCursor ?? undefined;
      return {
        queryKey: paginationQueryKey,
        page: page + 1,
        cursors,
      };
    });
  }, [data?.currentCursor, data?.nextCursor, page, paginationQueryKey]);

  const hasFilters =
    severity !== 'all' ||
    triageStatus !== 'all' ||
    debouncedSearch.length > 0 ||
    !!workflowId ||
    !!runId ||
    !!componentId ||
    !!dateRange ||
    !!scopeId;

  useEffect(() => {
    setSelectedIds(new Set());
  }, [paginationQueryKey]);

  // Bulk selection handlers (table view)
  const handleSelectToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_SELECTION) return prev;
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const currentPageIds = items.map((item) => item.id);
      const allCurrentPageSelected =
        currentPageIds.length > 0 && currentPageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allCurrentPageSelected) {
        currentPageIds.forEach((id) => next.delete(id));
        return next;
      }
      for (const id of currentPageIds) {
        if (next.size >= MAX_SELECTION) break;
        next.add(id);
      }
      return next;
    });
  }, [items]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 p-4 sm:p-6">
      <div className="w-full">
        <div
          data-testid="page-toolbar-filters"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
        >
          <Select value={severity} onValueChange={handleSeverityChange}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS}>
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
          <Select value={triageStatus} onValueChange={handleTriageStatusChange}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS}>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <WorkflowFilter
            value={workflowId}
            onChange={handleWorkflowChange}
            triggerClassName={FILTER_TRIGGER_CLASS}
          />
          <ToolFilter
            value={componentId}
            onChange={handleComponentChange}
            triggerClassName={FILTER_TRIGGER_CLASS}
          />
          <DateRangeFilter
            value={dateRange}
            onChange={handleDateRangeChange}
            triggerClassName={FILTER_TRIGGER_CLASS}
          />
          <ExportButton
            severity={queryParams.severity}
            search={queryParams.search}
            workflowId={queryParams.workflowId}
            runId={queryParams.runId}
            componentId={queryParams.componentId}
            dateFrom={queryParams.dateFrom}
            dateTo={queryParams.dateTo}
            scopeId={queryParams.scopeId}
            triageStatus={queryParams.triageStatus}
            className="w-full"
          />
        </div>
        {runId ? (
          <div className="mt-2 flex min-w-0 items-center gap-2 rounded-md border border-primary/25 bg-primary/[0.04] px-2.5 py-1.5 text-[11px]">
            <span className="text-muted-foreground">Filtered to run</span>
            <code className="min-w-0 flex-1 truncate text-foreground" title={runId}>
              {runId}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={clearRunFilter}
              aria-label="Clear run filter"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>

      {/* Severity Chart */}
      <SeverityChart
        severity={queryParams.severity}
        search={queryParams.search}
        workflowId={queryParams.workflowId}
        runId={queryParams.runId}
        componentId={queryParams.componentId}
        dateFrom={queryParams.dateFrom}
        dateTo={queryParams.dateTo}
        scopeId={queryParams.scopeId}
        triageStatus={queryParams.triageStatus}
      />

      {data && shouldShowFindingDataQuality(data) && (
        <div
          role="status"
          aria-label="Findings data quality"
          className="w-full rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          {describeFindingDataQuality(data)}
        </div>
      )}

      {/* Error */}
      {error && (
        <ErrorBanner
          message={error.message ?? 'Failed to load findings'}
          onRetry={() => refetch()}
        />
      )}

      {/* Loading (table view only — Kanban has per-column skeletons) */}
      {isLoading && items.length === 0 && activeView === 'table' && <FindingsTableSkeleton />}

      {/* Empty */}
      {!isLoading && !error && items.length === 0 && <FindingsEmptyState hasFilters={hasFilters} />}

      {/* Kanban View */}
      {activeView === 'kanban' && (
        <FindingsKanbanView items={items} isLoading={isLoading} onCardClick={selectFinding} />
      )}

      {/* Table View */}
      {activeView === 'table' && items.length > 0 && (
        <>
          {/* ARIA live region for selection count */}
          {selectedIds.size > 0 && (
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {selectedIds.size} finding{selectedIds.size !== 1 ? 's' : ''} selected
            </div>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={items.length > 0 && items.every((item) => selectedIds.has(item.id))}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all findings on this page"
                    />
                  </TableHead>
                  <TableHead className="w-[180px]">Timestamp</TableHead>
                  <TableHead className="w-[100px]">Severity</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="w-[120px]">Run ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((finding) => (
                  <TableRow
                    key={finding.id}
                    className="cursor-pointer hover:bg-muted/50"
                    data-state={selectedIds.has(finding.id) ? 'selected' : undefined}
                    onClick={() => selectFinding(finding.id)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(finding.id)}
                        disabled={!selectedIds.has(finding.id) && selectedIds.size >= MAX_SELECTION}
                        onCheckedChange={() => handleSelectToggle(finding.id)}
                        aria-label={`Select finding ${finding.name ?? finding.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(finding.timestamp)}
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={finding.severity} />
                    </TableCell>
                    <TableCell className="font-medium">{truncate(finding.name, 60)}</TableCell>
                    <TableCell className="text-sm">{truncate(finding.asset_key)}</TableCell>
                    <TableCell>
                      <TriageStatusBadge status={finding.triage?.status} />
                    </TableCell>
                    <TableCell className="text-sm">{truncate(finding.workflow_name)}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {finding.run_id ? finding.run_id.slice(0, 8) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {items.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * activePageSize + 1}–
            {Math.min((page - 1) * activePageSize + items.length, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={handlePreviousPage}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={isPlaceholderData || !data?.nextCursor}
              onClick={handleNextPage}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Bulk actions toolbar (table view) */}
      {activeView === 'table' && selectedIds.size > 0 && (
        <BulkActionsToolbar selectedIds={selectedIds} onClearSelection={handleClearSelection} />
      )}

      {/* Finding Detail Sheet */}
      <Suspense fallback={null}>
        <FindingDetailSheet
          findingId={selectedFindingId}
          isOpen={!!selectedFindingId}
          onClose={closeFinding}
        />
      </Suspense>
    </div>
  );
}
