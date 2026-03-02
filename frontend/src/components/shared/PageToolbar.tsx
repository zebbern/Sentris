import type { ReactNode, ChangeEvent } from 'react';
import { CircleHelp, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface PageToolbarProps {
  /** Page heading rendered as h2 (the layout top-bar provides the h1). Omit to skip the title row. */
  title?: string;
  /** URL linking to the relevant documentation page. Renders a help icon next to the title. */
  helpUrl?: string;
  /** Controlled search value. Provide along with onSearchChange to render the search row. */
  searchValue?: string;
  /** Callback fired when search input changes. */
  onSearchChange?: (value: string) => void;
  /** Placeholder text for the search input. */
  searchPlaceholder?: string;
  /** Label shown above the search input with a Search icon. Omit for an inline-icon style. */
  searchLabel?: string;
  /** Right-aligned action buttons (e.g. "New Item", "Refresh"). */
  actions?: ReactNode;
  /** Filter controls rendered next to the search input (e.g. status dropdown). */
  filters?: ReactNode;
  /** Bulk-selection bar rendered below the toolbar rows. */
  bulkBar?: ReactNode;
  /** Additional CSS classes for the outer wrapper. */
  className?: string;
}

export function PageToolbar({
  title,
  helpUrl,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  searchLabel,
  actions,
  filters,
  bulkBar,
  className,
}: PageToolbarProps) {
  const hasSearch = searchValue !== undefined && onSearchChange !== undefined;
  const hasTitle = Boolean(title);

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(e.target.value);
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Title row — h1 + help icon + actions */}
      {hasTitle && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
            {helpUrl && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="View documentation"
                    >
                      <CircleHelp className="h-4 w-4" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>View documentation</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}

      {/* Search row — input + (actions when no title) + filters */}
      {hasSearch && (
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex-1 space-y-2">
            {searchLabel ? (
              <>
                <label className="text-xs uppercase text-muted-foreground flex items-center gap-2">
                  <Search className="h-3.5 w-3.5" />
                  {searchLabel}
                </label>
                <Input
                  type="search"
                  placeholder={searchPlaceholder}
                  value={searchValue}
                  onChange={handleSearchChange}
                  aria-label={searchPlaceholder || 'Search'}
                />
              </>
            ) : (
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder={searchPlaceholder}
                  value={searchValue}
                  onChange={handleSearchChange}
                  className="pl-8"
                  autoComplete="off"
                  aria-label={searchPlaceholder || 'Search'}
                />
              </div>
            )}
          </div>
          {((!hasTitle && actions) || filters) && (
            <div className="flex flex-wrap gap-2">
              {!hasTitle && actions}
              {filters}
            </div>
          )}
        </div>
      )}

      {/* Filters-only row — title present but no built-in search */}
      {hasTitle && !hasSearch && filters && <div className="flex flex-wrap gap-2">{filters}</div>}

      {/* Actions/filters-only fallback — no title, no search */}
      {!hasTitle && !hasSearch && (actions || filters) && (
        <>
          {filters}
          {actions}
        </>
      )}

      {bulkBar}
    </div>
  );
}
