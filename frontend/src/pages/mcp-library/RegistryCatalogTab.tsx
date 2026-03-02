import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Search,
  X,
  ServerCrash,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import {
  useRegistryCatalog,
  useTriggerRegistrySync,
  useRegistrySyncStatus,
} from '@/hooks/queries/useMcpRegistryQueries';
import { RegistryCategoryFilter } from './RegistryCategoryFilter';
import { RegistryServerCard } from './RegistryServerCard';
import { RegistryServerDetailSheet } from './RegistryServerDetailSheet';
import { RegistryImportSheet } from './RegistryImportSheet';
import { useDebounce } from '@/hooks/useDebounce';

const SERVER_TYPE_OPTIONS = ['All', 'Docker', 'Remote'] as const;
type ServerTypeFilter = (typeof SERVER_TYPE_OPTIONS)[number];

const PAGE_SIZE = 24;

/** Map UI server-type label to the API query param value */
function toServerTypeParam(filter: ServerTypeFilter): string | undefined {
  if (filter === 'Docker') return 'server';
  if (filter === 'Remote') return 'remote';
  return undefined;
}

export function RegistryCatalogTab() {
  const queryClient = useQueryClient();
  const gridRef = useRef<HTMLDivElement>(null);

  // Filter state
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [serverTypeFilter, setServerTypeFilter] = useState<ServerTypeFilter>('All');

  // Pagination state
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, selectedCategory, serverTypeFilter]);

  // Sheet state
  const [detailServerName, setDetailServerName] = useState<string | null>(null);
  const [importServerName, setImportServerName] = useState<string | null>(null);

  // Fetch catalog with server-side filtering & pagination
  const {
    data: catalogResponse,
    isLoading,
    isFetching,
    isPlaceholderData,
    error,
  } = useRegistryCatalog({
    search: debouncedSearch.trim() || undefined,
    category: selectedCategory ?? undefined,
    serverType: toServerTypeParam(serverTypeFilter),
    limit: PAGE_SIZE,
    offset,
  });

  const servers = catalogResponse?.data ?? [];
  const categories = catalogResponse?.categories ?? [];
  const total = catalogResponse?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startItem = total === 0 ? 0 : offset + 1;
  const endItem = Math.min(offset + PAGE_SIZE, total);
  const hasNextPage = endItem < total;
  const hasPrevPage = page > 0;

  const hasActiveFilters =
    searchInput.trim().length > 0 || selectedCategory !== null || serverTypeFilter !== 'All';

  // Sync hooks for cold-start auto-sync
  const syncStatus = useRegistrySyncStatus();
  const {
    mutate: triggerSyncMutate,
    isPending: isSyncing,
    isError: isSyncError,
  } = useTriggerRegistrySync();

  // Auto-trigger sync when catalog is empty and no sync has ever run
  const hasTriggeredAutoSync = useRef(false);
  useEffect(() => {
    if (
      !isLoading &&
      !error &&
      total === 0 &&
      !hasActiveFilters &&
      syncStatus.data?.lastSyncAt === null &&
      !hasTriggeredAutoSync.current &&
      !isSyncing
    ) {
      hasTriggeredAutoSync.current = true;
      triggerSyncMutate();
    }
  }, [isLoading, error, total, hasActiveFilters, syncStatus.data, isSyncing, triggerSyncMutate]);

  // Scroll to grid top on page change (but not on filter changes that reset to page 0)
  const prevPage = useRef(page);
  useEffect(() => {
    if (page !== prevPage.current && page !== 0 && gridRef.current) {
      gridRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    prevPage.current = page;
  }, [page]);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setSelectedCategory(null);
    setServerTypeFilter('All');
  }, []);

  const handleViewDetails = useCallback((name: string) => {
    setDetailServerName(name);
  }, []);

  const handleImport = useCallback((name: string) => {
    setDetailServerName(null);
    setImportServerName(name);
  }, []);

  const handleImportSheetClose = useCallback((isOpen: boolean) => {
    if (!isOpen) setImportServerName(null);
  }, []);

  const handleDetailSheetClose = useCallback((isOpen: boolean) => {
    if (!isOpen) setDetailServerName(null);
  }, []);

  return (
    <div className="space-y-4">
      {/* Search + Type filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search servers..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
            aria-label="Search registry servers"
          />
          {searchInput && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchInput('')}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Server type toggle */}
        <div className="flex rounded-md border" role="group" aria-label="Filter by server type">
          {SERVER_TYPE_OPTIONS.map((option) => (
            <Button
              key={option}
              variant={serverTypeFilter === option ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none first:rounded-l-md last:rounded-r-md border-0"
              onClick={() => setServerTypeFilter(option)}
              aria-pressed={serverTypeFilter === option}
            >
              {option}
            </Button>
          ))}
        </div>
      </div>

      {/* Category filter */}
      <RegistryCategoryFilter
        categories={categories}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
      />

      {/* Error state */}
      {error && (
        <ErrorBanner
          message={error.message || 'Failed to load registry catalog'}
          onRetry={() =>
            queryClient.invalidateQueries({ queryKey: queryKeys.mcpRegistry.catalog() })
          }
        />
      )}

      {/* Loading state (initial load only) */}
      {isLoading && (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          aria-busy="true"
          aria-label="Loading servers"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[220px]">
              <Skeleton className="h-full w-full rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading &&
        !error &&
        servers.length === 0 &&
        (isSyncing ? (
          <EmptyState
            icon={Loader2}
            title="Syncing catalog\u2026"
            description="Fetching servers from the Docker MCP Registry. This may take a moment."
            className="[&_svg]:animate-spin"
          />
        ) : (
          <EmptyState
            icon={ServerCrash}
            title="No servers found"
            description={
              hasActiveFilters
                ? 'Try adjusting your search or filters.'
                : isSyncError
                  ? 'Sync failed. Please try again.'
                  : 'The registry catalog is empty. Sync to populate it from the Docker MCP Registry.'
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => triggerSyncMutate()}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Sync Now
                </Button>
              )
            }
          />
        ))}

      {/* Server grid */}
      {!isLoading && !error && servers.length > 0 && (
        <div
          ref={gridRef}
          className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 transition-opacity ${
            isFetching && isPlaceholderData ? 'opacity-60' : ''
          }`}
          role="list"
          aria-label="Registry servers"
        >
          {servers.map((server) => (
            <div key={server.name} role="listitem">
              <RegistryServerCard
                server={server}
                onViewDetails={handleViewDetails}
                onImport={handleImport}
              />
            </div>
          ))}
        </div>
      )}

      {/* Pagination controls */}
      {!isLoading && !error && total > 0 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            Showing {startItem}–{endItem} of {total} servers
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrevPage || isFetching}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNextPage || isFetching}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Detail Sheet */}
      <RegistryServerDetailSheet
        serverName={detailServerName}
        open={detailServerName !== null}
        onOpenChange={handleDetailSheetClose}
        onImport={handleImport}
      />

      {/* Import Sheet */}
      <RegistryImportSheet
        serverName={importServerName}
        open={importServerName !== null}
        onOpenChange={handleImportSheetClose}
      />
    </div>
  );
}
