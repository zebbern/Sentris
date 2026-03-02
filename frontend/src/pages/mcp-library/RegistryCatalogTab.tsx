import { useCallback, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Search, X, ServerCrash } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { useRegistryCatalog } from '@/hooks/queries/useMcpRegistryQueries';
import { RegistryCategoryFilter } from './RegistryCategoryFilter';
import { RegistryServerCard } from './RegistryServerCard';
import { RegistryServerDetailSheet } from './RegistryServerDetailSheet';
import { RegistryImportSheet } from './RegistryImportSheet';
import { useDebounce } from '@/hooks/useDebounce';

const SERVER_TYPE_OPTIONS = ['All', 'Docker', 'Remote'] as const;
type ServerTypeFilter = (typeof SERVER_TYPE_OPTIONS)[number];

export function RegistryCatalogTab() {
  const queryClient = useQueryClient();

  // Filter state
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [serverTypeFilter, setServerTypeFilter] = useState<ServerTypeFilter>('All');

  // Sheet state
  const [detailServerName, setDetailServerName] = useState<string | null>(null);
  const [importServerName, setImportServerName] = useState<string | null>(null);

  // Fetch catalog (all items, client-side filtering)
  const { data: catalogResponse, isLoading, error } = useRegistryCatalog();

  // Client-side filtering
  const filteredServers = useMemo(() => {
    if (!catalogResponse?.data) return [];
    let items = catalogResponse.data;

    // Search filter
    if (debouncedSearch.trim()) {
      const query = debouncedSearch.trim().toLowerCase();
      items = items.filter(
        (s) =>
          s.displayName.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query) ||
          s.tags.some((t) => t.toLowerCase().includes(query)),
      );
    }

    // Category filter
    if (selectedCategory) {
      items = items.filter((s) => s.category === selectedCategory);
    }

    // Server type filter
    if (serverTypeFilter === 'Docker') {
      items = items.filter((s) => s.serverType === 'server');
    } else if (serverTypeFilter === 'Remote') {
      items = items.filter((s) => s.serverType === 'remote');
    }

    return items;
  }, [catalogResponse?.data, debouncedSearch, selectedCategory, serverTypeFilter]);

  const categories = useMemo(
    () => catalogResponse?.categories ?? [],
    [catalogResponse?.categories],
  );

  const hasActiveFilters =
    searchInput.trim().length > 0 || selectedCategory !== null || serverTypeFilter !== 'All';

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

      {/* Loading state */}
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
      {!isLoading && !error && filteredServers.length === 0 && (
        <EmptyState
          icon={ServerCrash}
          title="No servers found"
          description={
            hasActiveFilters
              ? 'Try adjusting your search or filters.'
              : 'The registry catalog is empty. It may need to sync.'
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Server grid */}
      {!isLoading && !error && filteredServers.length > 0 && (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          role="list"
          aria-label="Registry servers"
        >
          {filteredServers.map((server) => (
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

      {/* Results count */}
      {!isLoading && !error && catalogResponse && (
        <p
          className="text-xs text-muted-foreground text-center pt-2"
          role="status"
          aria-live="polite"
        >
          Showing {filteredServers.length} of {catalogResponse.data.length} servers
        </p>
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
