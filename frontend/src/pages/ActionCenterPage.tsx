import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortableList } from '@/hooks/useSortableList';
import { SortableTableRow, DragHandle } from '@/components/ui/sortable';
import { CheckCircle, XCircle, RefreshCw, Clock, Zap, ExternalLink } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ui/error-banner';
import { PageToolbar } from '@/components/shared/PageToolbar';
import { getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles';
import { formatDateTime, formatRelativeTime } from '@/utils/timeFormat';
import { useHumanInputs, useInvalidateHumanInputs } from '@/hooks/queries/useHumanInputQueries';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
  pending: Clock,
  approved: CheckCircle,
  rejected: XCircle,
  expired: Clock,
  cancelled: XCircle,
};

import {
  HumanInputResolutionView,
  type HumanInputRequest,
} from '@/components/workflow/HumanInputResolutionView';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuthStore } from '@/store/authStore';

export function ActionCenterPage() {
  useDocumentTitle('Action Center');
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved' | 'expired'>(
    'pending',
  );
  const [actionState] = useState<Record<string, 'approve' | 'reject' | 'view'>>({});

  const organizationId = useAuthStore((state) => state.organizationId);

  const status = statusFilter === 'all' ? undefined : statusFilter;
  const {
    data: rawApprovals = [],
    isLoading,
    error: queryError,
    dataUpdatedAt,
  } = useHumanInputs({ status });
  const approvals = rawApprovals as HumanInputRequest[];
  const invalidateHumanInputs = useInvalidateHumanInputs();
  const error = queryError?.message ?? null;

  // Tick every 5s to keep the "Last updated" relative time current
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const lastUpdatedText = useMemo(() => {
    if (!dataUpdatedAt) return null;
    const diffSeconds = Math.floor((now - dataUpdatedAt) / 1000);
    if (diffSeconds < 5) return 'just now';
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    return `${Math.floor(diffMinutes / 60)}h ago`;
  }, [dataUpdatedAt, now]);

  // Resolve dialog state
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolveAction, setResolveAction] = useState<'approve' | 'reject' | 'view'>('approve');
  const [selectedApproval, setSelectedApproval] = useState<HumanInputRequest | null>(null);

  const filteredApprovals = useMemo(() => {
    const query = search.trim().toLowerCase();
    return approvals.filter((approval) => {
      const matchesSearch =
        query.length === 0 ||
        approval.title.toLowerCase().includes(query) ||
        approval.nodeRef.toLowerCase().includes(query) ||
        approval.runId.toLowerCase().includes(query);
      return matchesSearch;
    });
  }, [search, approvals]);

  const hasActiveFilters = search.trim().length > 0 || statusFilter !== 'all';

  const getApprovalId = useCallback((a: HumanInputRequest) => a.id, []);

  const {
    orderedItems: orderedApprovals,
    sensors,
    collisionDetection,
    handleDragEnd,
    isDragDisabled,
  } = useSortableList({
    items: filteredApprovals,
    getId: getApprovalId,
    storageKey: `shipsec:sort:actioncenter:${organizationId}`,
    disabled: hasActiveFilters,
  });

  const pendingCount = approvals.filter((a) => a.status === 'pending').length;

  const openResolveDialog = (
    approval: HumanInputRequest,
    action: 'approve' | 'reject' | 'view',
  ) => {
    setSelectedApproval(approval);
    setResolveAction(action);
    setResolveDialogOpen(true);
  };

  const handleRefresh = async () => {
    await invalidateHumanInputs();
    toast({
      title: 'Requests refreshed',
      description: 'Latest status have been loaded.',
    });
  };

  const isActionBusy = (id: string) => Boolean(actionState[id]);

  const renderStatusBadge = (approval: HumanInputRequest) => {
    let status = approval.status as string;
    if (status === 'resolved' && approval.responseData?.status) {
      status = approval.responseData.status as string;
    }

    const label = status.charAt(0).toUpperCase() + status.slice(1);
    const Icon = STATUS_ICONS[status] || Clock;
    return (
      <Badge variant="outline" className={getStatusBadgeClassFromStatus(status, 'gap-1')}>
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    );
  };

  const hasData = orderedApprovals.length > 0;

  return (
    <TooltipProvider>
      <div className="flex-1 bg-background" aria-busy={isLoading}>
        <div className="container mx-auto px-3 md:px-4 py-4 md:py-8 space-y-4 md:space-y-6">
          {/* Header */}
          {pendingCount > 0 && (
            <div className="flex items-center">
              <Badge variant="default" className="text-base px-3 py-1">
                {pendingCount} pending
              </Badge>
            </div>
          )}

          {/* Filters */}
          <PageToolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Filter by title, node, or run ID"
            searchLabel="Search requests"
            filters={
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            actions={
              <div className="flex items-center gap-3">
                {lastUpdatedText && (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    Updated {lastUpdatedText}
                  </span>
                )}
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleRefresh}
                  disabled={isLoading}
                >
                  <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
              </div>
            }
          />

          {error && <ErrorBanner message={error} onRetry={handleRefresh} />}

          {/* Table */}
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragEnd={handleDragEnd}
              >
                <Table className="table-fixed w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Title</TableHead>
                      <TableHead className="hidden md:table-cell">Node</TableHead>
                      <TableHead className="hidden lg:table-cell">Run ID</TableHead>
                      <TableHead className="hidden sm:table-cell whitespace-nowrap">
                        Created
                      </TableHead>
                      <TableHead className="hidden lg:table-cell whitespace-nowrap">
                        Timeout
                      </TableHead>
                      <TableHead className="whitespace-nowrap">Status</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && !hasData
                      ? Array.from({ length: 4 }).map((_, index) => (
                          <TableRow key={`skeleton-${index}`}>
                            <TableCell>
                              <Skeleton className="h-4 w-4" />
                            </TableCell>
                            {Array.from({ length: 7 }).map((_, cell) => (
                              <TableCell key={`cell-${cell}`}>
                                <Skeleton className="h-5 w-full" />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      : null}
                    {!isLoading && hasData ? (
                      <SortableContext
                        items={orderedApprovals.map((a) => a.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {orderedApprovals.map((approval) => {
                          const isPending = approval.status === 'pending';

                          return (
                            <SortableTableRow
                              key={approval.id}
                              id={approval.id}
                              disabled={isDragDisabled}
                            >
                              {({ handleProps }) => (
                                <>
                                  <DragHandle {...handleProps} disabled={isDragDisabled} />
                                  <TableCell className="font-medium">
                                    <div className="flex flex-col min-w-0">
                                      <span className="truncate">{approval.title}</span>
                                      {approval.description && (
                                        <span className="text-xs text-muted-foreground truncate">
                                          {approval.description}
                                        </span>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="hidden md:table-cell">
                                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                      {approval.nodeRef}
                                    </code>
                                  </TableCell>
                                  <TableCell className="hidden lg:table-cell">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <a
                                          href={`/workflows/${approval.workflowId}/runs/${approval.runId}`}
                                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                                        >
                                          {approval.runId.substring(0, 12)}...
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      </TooltipTrigger>
                                      <TooltipContent>View run details</TooltipContent>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell className="text-sm hidden sm:table-cell whitespace-nowrap">
                                    {formatDateTime(approval.createdAt)}
                                  </TableCell>
                                  <TableCell className="text-sm hidden lg:table-cell whitespace-nowrap">
                                    {approval.timeoutAt ? (
                                      <span
                                        className={
                                          approval.status === 'pending' ? 'text-warning' : ''
                                        }
                                      >
                                        {formatRelativeTime(approval.timeoutAt)}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">No timeout</span>
                                    )}
                                  </TableCell>
                                  <TableCell>{renderStatusBadge(approval)}</TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      {isPending ? (
                                        <>
                                          {approval.inputType === 'approval' ||
                                          approval.inputType === 'review' ? (
                                            <>
                                              <Button
                                                variant="default"
                                                size="sm"
                                                className="gap-1 h-8"
                                                onClick={() =>
                                                  openResolveDialog(approval, 'approve')
                                                }
                                                disabled={isActionBusy(approval.id)}
                                              >
                                                <CheckCircle className="h-4 w-4" />
                                                Approve
                                              </Button>
                                              <Button
                                                variant="destructive"
                                                size="sm"
                                                className="gap-1 h-8"
                                                onClick={() =>
                                                  openResolveDialog(approval, 'reject')
                                                }
                                                disabled={isActionBusy(approval.id)}
                                              >
                                                <XCircle className="h-4 w-4" />
                                                Reject
                                              </Button>
                                            </>
                                          ) : (
                                            <Button
                                              variant="default"
                                              size="sm"
                                              className="gap-1 h-8"
                                              onClick={() => openResolveDialog(approval, 'approve')}
                                              disabled={isActionBusy(approval.id)}
                                            >
                                              {approval.inputType === 'acknowledge'
                                                ? 'Acknowledge'
                                                : 'Respond'}
                                            </Button>
                                          )}
                                        </>
                                      ) : (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="gap-1 h-8"
                                          onClick={() => openResolveDialog(approval, 'view')}
                                        >
                                          <ExternalLink className="h-4 w-4" />
                                          View Details
                                        </Button>
                                      )}
                                    </div>
                                  </TableCell>
                                </>
                              )}
                            </SortableTableRow>
                          );
                        })}
                      </SortableContext>
                    ) : null}
                    {!isLoading && !hasData && (
                      <TableRow>
                        <TableCell colSpan={8}>
                          <EmptyState
                            icon={Zap}
                            title="No pending actions"
                            description={
                              statusFilter === 'pending'
                                ? 'All requests have been handled. Check back later or view all statuses.'
                                : 'No requests match your filters. Try adjusting the search or status filter.'
                            }
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
        </div>
      </div>

      {/* Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <div className="overflow-y-auto px-1">
            {selectedApproval && (
              <HumanInputResolutionView
                request={selectedApproval}
                initialAction={resolveAction}
                onResolved={() => {
                  setResolveDialogOpen(false);
                  invalidateHumanInputs();
                }}
                onCancel={() => setResolveDialogOpen(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
