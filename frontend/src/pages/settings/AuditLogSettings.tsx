import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ClipboardList, Download, RefreshCw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useAuditLogs } from '@/hooks/queries/useAuditLogQueries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { humanizeApiError } from '@/lib/humanizeApiError';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { hasAdminRole } from '@/utils/auth';
import { api } from '@/services/api';
import { MultiSelectFilter } from './MultiSelectFilter';
import { DateTimeRangePicker } from './DateTimeRangePicker';

const RESOURCE_TYPE_OPTIONS = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'secret', label: 'Secret' },
  { value: 'api_key', label: 'API Key' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'artifact', label: 'Artifact' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'mcp_server', label: 'MCP Server' },
  { value: 'mcp_group', label: 'MCP Group' },
  { value: 'human_input', label: 'Human Input' },
] as const;

const ACTION_OPTIONS = [
  'analytics.query',
  'api_key.create',
  'api_key.update',
  'api_key.revoke',
  'api_key.reactivate',
  'api_key.delete',
  'artifact.download',
  'artifact.delete',
  'human_input.resolve',
  'mcp_group.import_template',
  'mcp_group.create',
  'mcp_group.update',
  'mcp_group.delete',
  'mcp_server.create',
  'mcp_server.update',
  'mcp_server.toggle',
  'mcp_server.delete',
  'schedule.create',
  'schedule.update',
  'schedule.delete',
  'schedule.pause',
  'schedule.resume',
  'schedule.trigger',
  'secret.create',
  'secret.rotate',
  'secret.access',
  'secret.update',
  'secret.delete',
  'webhook.create',
  'webhook.update',
  'webhook.delete',
  'webhook.regenerate_path',
  'webhook.url_access',
  'workflow.create',
  'workflow.update',
  'workflow.update_metadata',
  'workflow.commit',
  'workflow.run',
  'workflow.delete',
] as const;

function formatTimestamp(iso: string) {
  return format(new Date(iso), 'MMM d, HH:mm:ss');
}

function safeJsonPreview(value: Record<string, unknown> | null) {
  if (!value || Object.keys(value).length === 0) return '—';
  try {
    const str = JSON.stringify(value);
    if (str === '{}') return '—';
    return str;
  } catch {
    return '—';
  }
}

export function AuditLogSettings() {
  useDocumentTitle('Settings · Audit Log');
  const roles = useAuthStore((state) => state.roles);
  const isAdmin = hasAdminRole(roles);

  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // Consolidated date range state
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});

  const filters = useMemo(
    () => ({
      action: selectedActions.length > 0 ? selectedActions.join(',') : undefined,
      resourceType: selectedResources.length > 0 ? selectedResources.join(',') : undefined,
      from: dateRange.from ? dateRange.from.toISOString() : undefined,
      to: dateRange.to ? dateRange.to.toISOString() : undefined,
      limit: 50,
    }),
    [selectedActions, selectedResources, dateRange],
  );

  const hasActiveFilters =
    selectedActions.length > 0 ||
    selectedResources.length > 0 ||
    dateRange.from !== undefined ||
    dateRange.to !== undefined;

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    error,
  } = useAuditLogs(filters, isAdmin);
  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const loading = isLoading || (isFetching && !isFetchingNextPage);
  const errorMessage = error ? humanizeApiError(error) : null;

  const clearFilters = () => {
    setSelectedActions([]);
    setSelectedResources([]);
    setDateRange({});
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const blob = await api.auditLogs.exportCsv({
        action: filters.action,
        resourceType: filters.resourceType,
        from: filters.from,
        to: filters.to,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      logger.error('Failed to export audit logs', err);
    } finally {
      setIsExporting(false);
    }
  };

  const toggleAction = (val: string) => {
    setSelectedActions((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val],
    );
  };

  const toggleResource = (val: string) => {
    setSelectedResources((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val],
    );
  };

  if (!isAdmin) {
    return (
      <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
        Audit logs are available to organization admins only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Audit Log</h2>
          <p className="text-sm text-muted-foreground">Review activity across your organization.</p>
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => void refetch()}
                  disabled={loading}
                  aria-label="Refresh logs"
                >
                  <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh logs</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={() => void handleExportCsv()}
                  disabled={isExporting}
                  aria-label="Download CSV"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Download CSV</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export filtered audit logs as CSV</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Filter Bar Above Table */}
      <div className="flex flex-wrap items-center gap-3 pb-2">
        <MultiSelectFilter
          label="Action"
          selectedValues={selectedActions}
          options={ACTION_OPTIONS}
          onToggle={toggleAction}
          onClear={() => setSelectedActions([])}
        />

        <MultiSelectFilter
          label="Resource"
          selectedValues={selectedResources}
          options={RESOURCE_TYPE_OPTIONS}
          onToggle={toggleResource}
          onClear={() => setSelectedResources([])}
        />

        <DateTimeRangePicker from={dateRange.from} to={dateRange.to} onSelect={setDateRange} />

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 text-xs text-muted-foreground hover:text-foreground px-3 gap-1.5 group font-medium"
          >
            <X className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
            Clear all
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-card shadow-sm overflow-hidden flex flex-col">
        {errorMessage && (
          <ErrorBanner
            message={errorMessage}
            onRetry={() => void refetch()}
            className="mx-4 mt-4"
          />
        )}

        <div className="overflow-x-auto">
          <Table className="table-fixed w-full" aria-label="Audit log">
            {(items.length > 0 || isLoading) && (
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[160px]">Time</TableHead>
                  <TableHead className="min-w-[120px]">Actor</TableHead>
                  <TableHead className="min-w-[200px]">Action</TableHead>
                  <TableHead className="min-w-[180px] hidden md:table-cell">Resource</TableHead>
                  <TableHead className="hidden sm:table-cell">Details</TableHead>
                </TableRow>
              </TableHeader>
            )}
            <TableBody>
              {isLoading && !items.length
                ? Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={`skeleton-${index}`}>
                      {Array.from({ length: 5 }).map((_, cell) => (
                        <TableCell key={`cell-${cell}`}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : null}
              {items.length === 0 && !isFetching && !isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="hover:bg-transparent">
                    <EmptyState
                      icon={ClipboardList}
                      title="No events found"
                      description={
                        hasActiveFilters
                          ? 'Try adjusting your filters to see more results.'
                          : 'Audit events will appear here as actions are performed across your organization.'
                      }
                      action={
                        hasActiveFilters ? (
                          <Button variant="outline" onClick={clearFilters}>
                            Clear filters
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatTimestamp(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-normal">
                      {row.actorType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-medium">{row.action}</TableCell>
                  <TableCell className="text-sm hidden md:table-cell">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{row.resourceType}</span>
                      <span className="text-xs text-muted-foreground font-mono leading-tight truncate max-w-[180px]">
                        {row.resourceName ?? row.resourceId ?? '—'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-[300px] hidden sm:table-cell">
                    {safeJsonPreview(row.metadata)}
                  </TableCell>
                </TableRow>
              ))}
              {isFetchingNextPage && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-sm text-muted-foreground animate-pulse"
                  >
                    Loading more events...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="p-3 border-t flex items-center justify-between bg-muted/5">
          <div className="text-[10px] text-muted-foreground ml-2 font-bold tracking-widest uppercase opacity-70">
            {items.length} {items.length === 1 ? 'Event' : 'Events'} Loaded
          </div>
          {hasNextPage && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs px-4"
              disabled={isFetchingNextPage}
              onClick={() => {
                if (!hasNextPage) return;
                void fetchNextPage();
              }}
            >
              {isFetchingNextPage ? 'Loading...' : 'Load more'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
