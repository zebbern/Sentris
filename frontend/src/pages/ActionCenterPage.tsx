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
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortableList } from '@/hooks/useSortableList';
import { RefreshCw, Zap } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ui/error-banner';
import { PageToolbar } from '@/components/shared/PageToolbar';
import { DOCS_URLS } from '@/config/docs';
import { ActionCenterRow } from '@/pages/action-center/ActionCenterRow';
import { useHumanInputs, useInvalidateHumanInputs } from '@/hooks/queries/useHumanInputQueries';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'expired', label: 'Expired' },
];

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

  const handleRefresh = async () => {
    await invalidateHumanInputs();
    toast({
      title: 'Requests refreshed',
      description: 'Latest status have been loaded.',
    });
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

          {/* Filters */}
          <PageToolbar
            title="Action Center"
            helpUrl={DOCS_URLS.humanInTheLoop}
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
                                    setSearch('');
                                    setStatusFilter('all');
                                  }}
                                >
                                  Clear filters
                                </Button>
                              ) : statusFilter !== 'all' ? (
                                <Button variant="outline" onClick={() => setStatusFilter('all')}>
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
