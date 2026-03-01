import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { McpDiscoveryPreview } from '@/components/mcp/McpDiscoveryPreview';
import {
  Layers,
  ChevronDown,
  Cloud,
  Search,
  ArrowDownToLine,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { McpGroupTemplateResponse } from '@/services/mcpGroupsApi';
import type { DiscoveryPreviewItem } from './types';
import { getGroupTheme } from './utils';
import { GroupLogo } from './GroupLogo';

interface GroupTemplatesSectionProps {
  templates: McpGroupTemplateResponse[];
  isLoading: boolean;
  searchQuery: string;
  templatesOpen: boolean;
  onToggleTemplates: () => void;
  importedGroupSlugs: Set<string>;
  groupDiscoveryPreview: Record<string, DiscoveryPreviewItem[]>;
  discoveringGroups: Set<string>;
  importingTemplates: Set<string>;
  onTestAndDiscover: (template: McpGroupTemplateResponse) => void;
  onImportDiscovered: (template: McpGroupTemplateResponse) => void;
  onClearDiscoveryPreview: (slug: string) => void;
}

export function GroupTemplatesSection({
  templates,
  isLoading,
  searchQuery,
  templatesOpen,
  onToggleTemplates,
  importedGroupSlugs,
  groupDiscoveryPreview,
  discoveringGroups,
  importingTemplates,
  onTestAndDiscover,
  onImportDiscovered,
  onClearDiscoveryPreview,
}: GroupTemplatesSectionProps) {
  return (
    <div id="group-templates-section" className="mb-6">
      <div className="flex items-center gap-3 mb-4">
        <Layers className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Group templates</h2>
        <Badge variant="secondary" className="text-xs">
          {templates.length} {templates.length === 1 ? 'group' : 'groups'}
        </Badge>
        <div className="ml-auto">
          <Button type="button" variant="ghost" size="sm" onClick={onToggleTemplates}>
            {templatesOpen ? (
              <>
                Hide
                <ChevronDown className="h-4 w-4 ml-2 rotate-180" />
              </>
            ) : (
              <>
                Show
                <ChevronDown className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>

      {templatesOpen && (
        <>
          {isLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Card key={i} className="overflow-hidden">
                  <CardHeader className="pb-4">
                    <Skeleton className="h-5 w-40 mb-2" />
                    <Skeleton className="h-4 w-64" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-12 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : templates.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-8">
                <Cloud className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-muted-foreground text-sm">
                  {searchQuery ? 'No groups match your search.' : 'No group templates available.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {templates.map((template) => {
                const theme = getGroupTheme(template.slug);
                const isImported = importedGroupSlugs.has(template.slug);

                return (
                  <Card
                    key={template.slug}
                    className={cn('overflow-hidden border', theme.container)}
                  >
                    <CardHeader
                      className={cn(
                        'flex flex-row items-center gap-3 py-3 border-b',
                        theme.headerBorder,
                      )}
                    >
                      <div className={cn('p-2.5 rounded-lg border', theme.iconWrapper)}>
                        <GroupLogo
                          slug={template.slug}
                          name={template.name}
                          className={theme.iconText}
                        />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-base">{template.name}</h3>
                          <Badge variant="secondary" className="text-xs">
                            {template.servers.length} servers
                          </Badge>
                        </div>
                        {template.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {template.description}
                          </p>
                        )}
                      </div>
                      {isImported && (
                        <Badge variant="secondary" className="text-xs">
                          Imported
                        </Badge>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {groupDiscoveryPreview[template.slug] && (
                        <McpDiscoveryPreview
                          results={groupDiscoveryPreview[template.slug]}
                          onClear={() => onClearDiscoveryPreview(template.slug)}
                        />
                      )}

                      {groupDiscoveryPreview[template.slug] && (
                        <div className="flex items-center justify-between text-sm bg-success/10 border border-success/20 rounded-md px-3 py-2">
                          <span className="text-success">
                            {
                              groupDiscoveryPreview[template.slug].filter(
                                (r) => r.status === 'completed',
                              ).length
                            }{' '}
                            of {template.servers.length} servers ready
                          </span>
                        </div>
                      )}

                      <div className="flex justify-end gap-2 pt-2">
                        {groupDiscoveryPreview[template.slug] && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onClearDiscoveryPreview(template.slug)}
                          >
                            Clear
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onTestAndDiscover(template)}
                          disabled={discoveringGroups.has(template.slug)}
                        >
                          {discoveringGroups.has(template.slug) ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                              Discovering...
                            </>
                          ) : (
                            <>
                              <Search className="h-3 w-3 mr-2" />
                              Test & Discover
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          disabled={
                            isImported ||
                            importingTemplates.has(template.slug) ||
                            !groupDiscoveryPreview[template.slug] ||
                            groupDiscoveryPreview[template.slug].some(
                              (r) => r.status !== 'completed',
                            )
                          }
                          onClick={() => onImportDiscovered(template)}
                        >
                          {importingTemplates.has(template.slug) ? (
                            <>
                              <RefreshCw className="h-3 w-3 mr-2 animate-spin" />
                              Importing...
                            </>
                          ) : (
                            <>
                              <ArrowDownToLine className="h-3 w-3 mr-2" />
                              Import
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
