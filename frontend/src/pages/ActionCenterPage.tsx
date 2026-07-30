import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortableList } from '@/hooks/useSortableList';
import { Zap } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/error-banner';
import { ActionCenterRow } from '@/pages/action-center/ActionCenterRow';
import { useHumanInputs, useInvalidateHumanInputs } from '@/hooks/queries/useHumanInputQueries';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

import {
  HumanInputResolutionView,
  type HumanInputRequest,
} from '@/components/workflow/HumanInputResolutionView';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuthStore } from '@/store/authStore';

const ACTION_CENTER_STATUSES = new Set(['all', 'pending', 'resolved', 'expired']);

export function ActionCenterPage() {
  useDocumentTitle('Action Center');
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionState] = useState<Record<string, 'approve' | 'reject' | 'view'>>({});

  const organizationId = useAuthStore((state) => state.organizationId);
  const search = searchParams.get('search') ?? '';
  const rawStatus = searchParams.get('status') ?? 'pending';
  const statusFilter = ACTION_CENTER_STATUSES.has(rawStatus)
    ? (rawStatus as 'all' | 'pending' | 'resolved' | 'expired')
    : 'pending';

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
    storageKey: `sentris:sort:actioncenter:${organizationId}`,
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

  const handleRefresh = () => {
    void invalidateHumanInputs();
  };

  const isActionBusy = (id: string) => Boolean(actionState[id]);

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

          {error && <ErrorBanner message={error} onRetry={handleRefresh} />}

          {/* Table */}
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragEnd={handleDragEnd}
              >
                <Table className="table-fixed w-full" aria-label="Pending actions">
                  {(hasData || isLoading) && (
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
                        <TableHead className="hidden sm:table-cell whitespace-nowrap">
                          Status
                        </TableHead>
                        <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                  )}
                  <TableBody>
                    {isLoading && !hasData && !error
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
                        {orderedApprovals.map((approval) => (
                          <ActionCenterRow
                            key={approval.id}
                            approval={approval}
                            isDragDisabled={isDragDisabled}
                            isActionBusy={isActionBusy(approval.id)}
                            onOpenResolveDialog={openResolveDialog}
                          />
                        ))}
                      </SortableContext>
                    ) : null}
                    {!isLoading && !hasData && !error && (
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
                            action={
                              search.trim().length > 0 ? (
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    const next = new URLSearchParams(searchParams);
                                    next.delete('search');
                                    next.set('status', 'all');
                                    setSearchParams(next, { replace: true });
                                  }}
                                >
                                  Clear filters
                                </Button>
                              ) : statusFilter !== 'all' ? (
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    const next = new URLSearchParams(searchParams);
                                    next.set('status', 'all');
                                    setSearchParams(next, { replace: true });
                                  }}
                                >
                                  View all statuses
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
          {lastUpdatedText ? (
            <p className="text-right text-xs text-muted-foreground whitespace-nowrap">
              Updated {lastUpdatedText}
            </p>
          ) : null}
        </div>
      </div>

      {/* Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogTitle className="sr-only">Resolve Approval</DialogTitle>
          <DialogDescription className="sr-only">
            Review and respond to the approval request
          </DialogDescription>
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
