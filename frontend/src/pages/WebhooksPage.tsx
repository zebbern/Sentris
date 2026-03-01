import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageToolbar } from '@/components/shared/PageToolbar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RefreshCw, Plus } from 'lucide-react';
import { useSortableList } from '@/hooks/useSortableList';
import { cn } from '@/lib/utils';
import { humanizeApiError } from '@/lib/humanizeApiError';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useBulkMutation } from '@/hooks/useBulkMutation';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import {
  useWebhooks,
  useDeleteWebhook,
  useRegenerateWebhookPath,
} from '@/hooks/queries/useWebhookQueries';
import { useWorkflowsSummary } from '@/hooks/queries/useWorkflowQueries';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { env } from '@/config/env';
import { useAuthStore } from '@/store/authStore';
import {
  getWorkflowName,
  getStatusBadgeProps,
  type WorkflowOption,
  type BadgeVariant,
} from '@/utils/tableHelpers';
import { WebhooksTable } from './webhooks/WebhooksTable';
import type { WebhookConfiguration } from '@sentris/shared';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  active: 'default',
  inactive: 'secondary',
  error: 'destructive',
};

const WEBHOOK_BASE_URL = env.VITE_API_URL || 'http://localhost:3211';

export function WebhooksPage() {
  useDocumentTitle('Webhooks');
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionState, setActionState] = useState<Record<string, 'delete' | 'regenerate' | 'test'>>(
    {},
  );
  const organizationId = useAuthStore((state) => state.organizationId);
  const { copy } = useCopyToClipboard();

  const initialWorkflowId = searchParams.get('workflowId') || null;
  const [filters, setFilters] = useState<{
    search: string;
    status: string;
    workflowId: string | null;
  }>({ search: '', status: 'all', workflowId: initialWorkflowId });

  const { data: webhooks = [], isLoading, error: webhooksError } = useWebhooks();
  const error = webhooksError?.message ?? null;

  const { data: workflowsRaw = [], isLoading: workflowsLoading } = useWorkflowsSummary();
  const workflowOptions: WorkflowOption[] = useMemo(
    () => workflowsRaw.map((w) => ({ id: w.id, name: w.name ?? 'Untitled workflow' })),
    [workflowsRaw],
  );

  const deleteWebhookMutation = useDeleteWebhook();
  const regeneratePathMutation = useRegenerateWebhookPath();

  const filteredWebhooks = useMemo(() => {
    const query = filters.search.trim().toLowerCase();

    return webhooks.filter((webhook) => {
      const workflowName = getWorkflowName(webhook.workflowId, workflowOptions);
      const matchesSearch =
        query.length === 0 ||
        webhook.name.toLowerCase().includes(query) ||
        workflowName.toLowerCase().includes(query) ||
        webhook.webhookPath.toLowerCase().includes(query);

      const matchesStatus = filters.status === 'all' || webhook.status === filters.status;

      return matchesSearch && matchesStatus;
    });
  }, [filters.search, filters.status, webhooks, workflowOptions]);

  const hasActiveFilters =
    filters.search.trim().length > 0 || filters.status !== 'all' || filters.workflowId !== null;

  const getWebhookId = useCallback((w: WebhookConfiguration) => w.id, []);

  const {
    orderedItems: orderedWebhooks,
    sensors,
    collisionDetection,
    handleDragEnd,
    isDragDisabled,
  } = useSortableList({
    items: filteredWebhooks,
    getId: getWebhookId,
    storageKey: `sentris:sort:webhooks:${organizationId}`,
    disabled: hasActiveFilters,
  });

  const {
    selectedIds,
    toggleId,
    toggleAll,
    clearSelection,
    isAllSelected,
    isIndeterminate,
    selectedCount,
  } = useBulkSelection(orderedWebhooks);

  const executeBulkDelete = useBulkMutation({
    mutateAsync: (id: string) => deleteWebhookMutation.mutateAsync(id),
    clearSelection,
    toast,
    messages: {
      successTitle: (n) => `Deleted ${n} webhook${n !== 1 ? 's' : ''}`,
      successDescription: (n) => `${n} webhook${n !== 1 ? 's' : ''} permanently removed.`,
      partialDescription: (s, total, f) => `Deleted ${s} of ${total} webhooks (${f} failed).`,
    },
  });

  const handleBulkDelete = async () => {
    const count = selectedCount;
    const ok = await confirm({
      title: `Delete ${count} webhook${count !== 1 ? 's' : ''}`,
      description: `Are you sure you want to delete ${count} webhook${count !== 1 ? 's' : ''}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await executeBulkDelete(Array.from(selectedIds));
  };

  const handleWorkflowFilterChange = (value: string) => {
    const workflowId = value === 'all' ? null : value;
    setFilters((prev) => ({ ...prev, workflowId }));
    const nextParams = new URLSearchParams(searchParams);
    if (workflowId) {
      nextParams.set('workflowId', workflowId);
    } else {
      nextParams.delete('workflowId');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleStatusFilterChange = (value: string) => {
    setFilters((prev) => ({ ...prev, status: value as typeof filters.status }));
  };

  const handleCopyUrl = async (webhook: WebhookConfiguration) => {
    const url = `${WEBHOOK_BASE_URL}/webhooks/inbound/${webhook.webhookPath}`;
    await copy(url, {
      successTitle: 'Webhook URL copied',
      successDescription: 'The webhook URL has been copied to your clipboard.',
      errorTitle: 'Failed to copy',
      errorDescription: 'Could not copy the webhook URL to clipboard.',
    });
  };

  const handleRefresh = async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all() });
      toast({
        title: 'Webhooks refreshed',
        description: 'Latest webhook configurations have been loaded.',
      });
    } catch (_err: unknown) {
      toast({
        title: 'Refresh failed',
        description: humanizeApiError(_err),
        variant: 'destructive',
      });
    }
  };

  const isActionBusy = useCallback((id: string) => Boolean(actionState[id]), [actionState]);

  const handleDelete = async (webhook: WebhookConfiguration) => {
    const ok = await confirm({
      title: 'Delete webhook',
      description: `Are you sure you want to delete the webhook "${webhook.name}"?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;

    setActionState((prev) => ({ ...prev, [webhook.id]: 'delete' }));
    try {
      await deleteWebhookMutation.mutateAsync(webhook.id);
      toast({
        title: 'Webhook deleted',
        description: `Successfully deleted webhook ${webhook.name}`,
      });
    } catch {
      // Global MutationCache error handler shows the toast
    } finally {
      setActionState((prev) => {
        const { [webhook.id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleRegeneratePath = async (webhook: WebhookConfiguration) => {
    const ok = await confirm({
      title: 'Regenerate URL',
      description: `Are you sure you want to regenerate the URL for "${webhook.name}"? The old URL will stop working.`,
      confirmLabel: 'Regenerate',
    });
    if (!ok) return;

    setActionState((prev) => ({ ...prev, [webhook.id]: 'regenerate' }));
    try {
      await regeneratePathMutation.mutateAsync(webhook.id);
      toast({
        title: 'URL regenerated',
        description: 'New webhook URL has been generated',
      });
    } catch {
      // Global MutationCache error handler shows the toast
    } finally {
      setActionState((prev) => {
        const { [webhook.id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const getWorkflowNameForWebhook = useCallback(
    (w: WebhookConfiguration) => getWorkflowName(w.workflowId, workflowOptions),
    [workflowOptions],
  );

  const getStatusBadgePropsForWebhook = useCallback(
    (w: WebhookConfiguration) => getStatusBadgeProps(w.status, STATUS_VARIANTS),
    [],
  );

  const handleNavigateToWebhook = useCallback(
    (w: WebhookConfiguration) => navigate(`/webhooks/${w.id}`),
    [navigate],
  );

  const handleViewHistory = useCallback(
    (w: WebhookConfiguration) => navigate(`/webhooks/${w.id}/deliveries`),
    [navigate],
  );

  const bulkActions = useMemo(
    () => [
      { label: 'Delete selected', onClick: handleBulkDelete, variant: 'destructive' as const },
    ],
    [handleBulkDelete],
  );

  const hasData = orderedWebhooks.length > 0;

  return (
    <TooltipProvider>
      <div className="flex-1 bg-background" aria-busy={isLoading}>
        <div className="container mx-auto px-3 md:px-4 py-4 md:py-8 space-y-4 md:space-y-6">
          {/* Filters Row */}
          <PageToolbar
            title="Webhooks"
            filters={
              <div className="flex-1 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <label
                    htmlFor="webhook-filter-search"
                    className="text-xs uppercase text-muted-foreground"
                  >
                    Search
                  </label>
                  <Input
                    id="webhook-filter-search"
                    type="search"
                    placeholder="Filter by name, workflow, or URL"
                    value={filters.search}
                    onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="webhook-filter-status"
                    className="text-xs uppercase text-muted-foreground"
                  >
                    Status
                  </label>
                  <Select value={filters.status} onValueChange={handleStatusFilterChange}>
                    <SelectTrigger id="webhook-filter-status">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="webhook-filter-workflow"
                    className="text-xs uppercase text-muted-foreground"
                  >
                    Workflow
                  </label>
                  <Select
                    value={filters.workflowId ?? 'all'}
                    onValueChange={handleWorkflowFilterChange}
                    disabled={workflowsLoading}
                  >
                    <SelectTrigger id="webhook-filter-workflow">
                      <SelectValue placeholder="All workflows" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All workflows</SelectItem>
                      {workflowOptions.map((workflow) => (
                        <SelectItem key={workflow.id} value={workflow.id}>
                          {workflow.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            }
            actions={
              <div className="flex flex-col shrink-0">
                <div className="text-xs invisible hidden lg:block">&nbsp;</div>
                <div className="flex gap-2 mt-2 lg:mt-0">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={handleRefresh}
                    disabled={isLoading}
                  >
                    <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                    <span className="hidden sm:inline">Refresh</span>
                  </Button>
                  <Button
                    variant="default"
                    className="gap-2"
                    onClick={() => navigate('/webhooks/new')}
                  >
                    <Plus className="h-4 w-4" />
                    <span className="hidden sm:inline">New webhook</span>
                  </Button>
                </div>
              </div>
            }
            className="gap-4 lg:flex-row lg:items-end"
          />

          {error && <ErrorBanner message={error} onRetry={handleRefresh} />}

          <WebhooksTable
            orderedWebhooks={orderedWebhooks}
            isLoading={isLoading}
            hasData={hasData}
            isDragDisabled={isDragDisabled}
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={handleDragEnd}
            selectedIds={selectedIds}
            toggleId={toggleId}
            toggleAll={toggleAll}
            isAllSelected={isAllSelected}
            isIndeterminate={isIndeterminate}
            selectedCount={selectedCount}
            bulkActions={bulkActions}
            getWorkflowName={getWorkflowNameForWebhook}
            getStatusBadgeProps={getStatusBadgePropsForWebhook}
            isActionBusy={isActionBusy}
            onNavigate={handleNavigateToWebhook}
            onCopyUrl={handleCopyUrl}
            onViewHistory={handleViewHistory}
            onRegeneratePath={handleRegeneratePath}
            onDelete={handleDelete}
            onCreateNew={() => navigate('/webhooks/new')}
          />
        </div>
      </div>
      <ConfirmDialog {...dialogProps} />
    </TooltipProvider>
  );
}
