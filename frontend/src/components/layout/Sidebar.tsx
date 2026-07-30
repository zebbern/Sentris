import { useEffect, useState, useMemo } from 'react';
import { List, Grid3x3, Hand, Search, PanelLeftClose, X } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ComponentMetadata } from '@/schemas/component';
import { cn } from '@/lib/utils';
import { env } from '@/config/env';
import { Skeleton } from '@/components/ui/skeleton';
import { COMPONENT_CATEGORY_ORDER, isComponentCategory } from '@sentris/shared';
import { getCategorySeparatorColor, getCategoryTextColorClass } from '@/utils/categoryColors';
import { useThemeStore } from '@/store/themeStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useCustomScrollbar } from '@/hooks/useCustomScrollbar';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ComponentItem, type ViewMode } from './ComponentItem';

interface SidebarProps {
  canManageWorkflows?: boolean;
  /** When set, shows a hide-library control to the left of the search bar. */
  onHideLibrary?: () => void;
}

export function Sidebar({ canManageWorkflows = true, onHideLibrary }: SidebarProps) {
  const isMobile = useIsMobile();
  const { data: componentIndex, isLoading: loading, error: componentsError } = useComponents();
  const error = componentsError?.message ?? null;
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const theme = useThemeStore((state) => state.theme);
  const isDarkMode = theme === 'dark';
  const frontendBranch = env.VITE_FRONTEND_BRANCH.trim();
  const backendBranch = env.VITE_BACKEND_BRANCH.trim();
  const hasBranchInfo = Boolean(frontendBranch || backendBranch);

  // Get category accent color (for left border) - uses separator colors for brightness
  const getCategoryAccentColor = (category: string): string => {
    return getCategorySeparatorColor(category, isDarkMode);
  };

  // Get category text color with good contrast in both light and dark modes
  const getCategoryTextColor = (category: string): string => {
    return getCategoryTextColorClass(category);
  };

  const showDemoComponents = useWorkflowUiStore((state) => state.showDemoComponents);
  const allComponents = componentIndex ? Object.values(componentIndex.byId) : [];

  // Helper to identify demo components
  const isDemoComponent = (component: ComponentMetadata) => {
    const name = component.name.toLowerCase();
    const slug = component.slug.toLowerCase();
    const category = component.category.toLowerCase();
    const id = component.id.toLowerCase();

    return (
      category === 'demo' ||
      name.includes('demo') ||
      slug.includes('demo') ||
      name.includes('(test)') ||
      name === 'live event' ||
      name === 'parallel sleep' ||
      slug === 'live-event' ||
      slug === 'parallel-sleep' ||
      id.startsWith('test.') ||
      id === 'docker-echo'
    );
  };

  // Filter out entry point component (always present, shouldn't be in the list)
  const filteredComponents = useMemo(() => {
    return allComponents.filter((component) => {
      if (component.id === 'core.workflow.entrypoint' || component.slug === 'entry-point') {
        return false;
      }
      if (!env.VITE_ENABLE_IT_OPS && component.category === 'it_ops') {
        return false;
      }
      // Hide demo components unless toggled on via special keypress
      if (!showDemoComponents && isDemoComponent(component)) {
        return false;
      }
      return true;
    });
  }, [allComponents, showDemoComponents]);

  // Group components by backend-provided categories (memoized to prevent infinite loops)
  const componentsByCategory = useMemo(() => {
    return filteredComponents.reduce(
      (acc, component) => {
        const category = component.category;
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(component);
        return acc;
      },
      {} as Record<string, ComponentMetadata[]>,
    );
  }, [filteredComponents]);

  // Filter components based on search query
  const filteredComponentsByCategory = useMemo(() => {
    const filtered = searchQuery.trim()
      ? (() => {
          const query = searchQuery.toLowerCase();
          const result = {} as Record<string, ComponentMetadata[]>;

          Object.entries(componentsByCategory).forEach(([category, components]) => {
            const firstComponent = components[0];
            const categoryConfig = firstComponent?.categoryConfig;

            // Check if category name matches the search query
            const label = categoryConfig?.label?.toLowerCase();
            const desc = categoryConfig?.description?.toLowerCase();
            const categoryMatches =
              (label && label.includes(query)) ||
              (desc && desc.includes(query)) ||
              category.toLowerCase().includes(query);

            // Filter components within this category
            const matchingComponents = components.filter(
              (component) =>
                component.name.toLowerCase().includes(query) ||
                component.description?.toLowerCase().includes(query) ||
                component.id.toLowerCase().includes(query),
            );

            // Include category if either category name matches or components within it match
            if (categoryMatches || matchingComponents.length > 0) {
              result[category] = matchingComponents;
            }
          });

          return result;
        })()
      : componentsByCategory;

    // Sort categories by predefined order
    const sortedEntries = Object.entries(filtered).sort(([a], [b]) => {
      const indexA = isComponentCategory(a) ? COMPONENT_CATEGORY_ORDER.indexOf(a) : -1;
      const indexB = isComponentCategory(b) ? COMPONENT_CATEGORY_ORDER.indexOf(b) : -1;
      // If category not in order list, put it at the end
      if (indexA === -1 && indexB === -1) return 0;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

    return Object.fromEntries(sortedEntries);
  }, [componentsByCategory, searchQuery]);

  // Track open accordion items (controlled)
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([]);

  // Track whether we've initialized the accordion
  const [hasInitialized, setHasInitialized] = useState(false);

  // Initialize accordion: open all categories by default for better discoverability
  useEffect(() => {
    if (!hasInitialized && !searchQuery.trim()) {
      const categories = Object.keys(filteredComponentsByCategory);
      if (categories.length > 0) {
        // Open all categories by default
        setOpenAccordionItems(categories);
        setHasInitialized(true);
      }
    }
  }, [filteredComponentsByCategory, hasInitialized, searchQuery]);

  // Auto-expand all matching categories when search query changes
  useEffect(() => {
    if (searchQuery.trim()) {
      // When searching, open all categories that have matching components
      setOpenAccordionItems(Object.keys(filteredComponentsByCategory));
    } else if (hasInitialized) {
      // When clearing search, open all categories again
      const categories = Object.keys(filteredComponentsByCategory);
      setOpenAccordionItems(categories.length > 0 ? categories : []);
    }
    // Only depend on searchQuery - not filteredComponentsByCategory to avoid loops
  }, [searchQuery]);

  // Stable component count for scrollbar recalculation
  const componentCount = useMemo(() => {
    return Object.values(filteredComponentsByCategory).reduce(
      (total, components) => total + components.length,
      0,
    );
  }, [filteredComponentsByCategory]);

  // Custom scrollbar
  const { scrollContainerRef, scrollbarVisible, scrollbarPosition, scrollbarHeight } =
    useCustomScrollbar(componentCount, loading);

  return (
    <div className="h-full w-full max-w-[320px] border-r bg-background flex flex-col">
      <div className="border-b px-3 py-2 space-y-2">
        <div className="flex items-center gap-1.5">
          <TooltipProvider>
            {onHideLibrary && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    onClick={onHideLibrary}
                    className="h-8 w-8 shrink-0 p-0"
                    aria-expanded={true}
                    aria-label="Hide component library"
                  >
                    {isMobile ? <X className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Hide components</TooltipContent>
              </Tooltip>
            )}
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                placeholder="Search components..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 py-0 pl-8 text-sm"
                aria-label="Search components"
              />
            </div>
            <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-border/50 p-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn('h-6 px-2', viewMode === 'list' && 'bg-muted')}
                    onClick={() => setViewMode('list')}
                    aria-label="List view"
                    aria-pressed={viewMode === 'list'}
                  >
                    <List className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>List view</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={viewMode === 'tiles' ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn('h-6 px-2', viewMode === 'tiles' && 'bg-muted')}
                    onClick={() => setViewMode('tiles')}
                    aria-label="Tile view"
                    aria-pressed={viewMode === 'tiles'}
                  >
                    <Grid3x3 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Tile view</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>

        {hasBranchInfo && (
          <div className="space-y-1">
            {frontendBranch && (
              <p className="text-xs text-muted-foreground">Frontend branch: {frontendBranch}</p>
            )}
            {backendBranch && (
              <p className="text-xs text-muted-foreground">Backend branch: {backendBranch}</p>
            )}
          </div>
        )}
      </div>

      {/* Mobile helper text - only visible on small screens */}
      <div className="md:hidden px-4 py-2 border-b bg-muted/30">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Hand className="h-3 w-3" />
          Tap a component to add it to canvas
        </p>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="h-full w-full overflow-y-auto px-1.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {loading ? (
            <div className="space-y-0">
              <div>
                <div className="py-3">
                  <Skeleton className="h-4 w-24 mb-2" />
                  {viewMode === 'list' ? (
                    <div className="space-y-0.5">
                      {Array.from({ length: 6 }).map((_, idx) => (
                        <div key={idx} className="flex items-center gap-3 px-3 py-2">
                          <Skeleton className="h-5 w-5 rounded flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <Skeleton className="h-4 w-32 mb-1" />
                            <Skeleton className="h-3 w-48" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                      {Array.from({ length: 4 }).map((_, idx) => (
                        <div key={idx} className="rounded-md p-2 bg-background/50">
                          <div className="flex flex-col items-center gap-1">
                            <Skeleton className="h-4 w-4 rounded" />
                            <Skeleton className="h-3 w-14" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : error ? (
            <div className="text-sm text-red-500 text-center py-8">
              Failed to load components: {error}
            </div>
          ) : filteredComponents.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No components available
            </div>
          ) : (
            <div className="space-y-2">
              {/* Search results message */}
              {searchQuery.trim() && (
                <div className="text-xs text-muted-foreground px-0.5 pb-1">
                  Found{' '}
                  {Object.values(filteredComponentsByCategory).reduce(
                    (total, components) => total + components.length,
                    0,
                  )}
                  {Object.values(filteredComponentsByCategory).reduce(
                    (total, components) => total + components.length,
                    0,
                  ) !== 1
                    ? ' components'
                    : ' component'}{' '}
                  matching &quot;{searchQuery}&quot;
                </div>
              )}

              {Object.keys(filteredComponentsByCategory).length > 0 && (
                <Accordion
                  type="multiple"
                  className="space-y-1.5"
                  value={openAccordionItems}
                  onValueChange={setOpenAccordionItems}
                >
                  {Object.entries(filteredComponentsByCategory).map(([category, components]) => {
                    if (components.length === 0) return null;

                    const categoryConfig = components[0]?.categoryConfig;

                    const categoryAccentColor = getCategoryAccentColor(category);

                    return (
                      <AccordionItem
                        key={category}
                        value={category}
                        className="rounded-sm border border-border/50 px-2 py-0.5 transition-colors"
                      >
                        <AccordionTrigger
                          className={cn(
                            'relative -mx-2 -my-0.5 rounded-sm px-2 py-2 hover:bg-muted/50 hover:no-underline [&[data-state=open]]:text-foreground',
                            'group transition-colors',
                          )}
                          style={{
                            borderLeftWidth: categoryAccentColor ? '3px' : undefined,
                            borderLeftColor: categoryAccentColor || undefined,
                          }}
                        >
                          <div className="flex w-full flex-col items-start gap-0.5">
                            <div className="flex w-full items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                {categoryConfig?.icon && (
                                  <DynamicIcon
                                    name={categoryConfig.icon}
                                    className={cn(
                                      'h-3.5 w-3.5 shrink-0',
                                      getCategoryTextColor(category),
                                    )}
                                  />
                                )}
                                <h3
                                  className={cn(
                                    'text-xs font-semibold transition-colors',
                                    getCategoryTextColor(category),
                                  )}
                                >
                                  {categoryConfig?.label ?? category}
                                </h3>
                              </div>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-0 pb-1.5 pt-0.5">
                          {viewMode === 'list' ? (
                            <div className="space-y-0.5">
                              {components.map((component) => (
                                <ComponentItem
                                  key={component.id}
                                  component={component}
                                  disabled={!canManageWorkflows}
                                  viewMode={viewMode}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-1">
                              {components.map((component) => (
                                <ComponentItem
                                  key={component.id}
                                  component={component}
                                  disabled={!canManageWorkflows}
                                  viewMode={viewMode}
                                />
                              ))}
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}

              {/* Show no results message if search yields nothing */}
              {searchQuery.trim() &&
                Object.values(filteredComponentsByCategory).every(
                  (components) => components.length === 0,
                ) && (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">
                      No components found matching &quot;{searchQuery}&quot;
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Try different keywords or clear the search
                    </p>
                  </div>
                )}

              <div className="pt-2 border-t mt-2">
                <p className="text-xs text-muted-foreground px-0.5">
                  {searchQuery.trim()
                    ? `${Object.values(filteredComponentsByCategory).reduce((total, components) => total + components.length, 0)} of ${filteredComponents.length} component${filteredComponents.length !== 1 ? 's' : ''} shown`
                    : `${filteredComponents.length} component${filteredComponents.length !== 1 ? 's' : ''} available`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Custom overlay scrollbar */}
        {scrollbarHeight > 0 && (
          <div
            className={cn(
              'absolute right-1 top-2 w-0.5 bg-muted-foreground/50 rounded-full transition-opacity duration-300 pointer-events-none z-10',
              scrollbarVisible ? 'opacity-100' : 'opacity-0',
            )}
            style={{
              height: `${scrollbarHeight}px`,
              transform: `translateY(${scrollbarPosition}px)`,
            }}
          />
        )}
      </div>
    </div>
  );
}
