import { useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, RefreshCw, Server, Wrench } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useMcpAllTools, useMcpServers } from '@/hooks/queries/useMcpServerQueries';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

export interface McpLibraryToolSelectorProps {
  selectedServerIds: string[];
  useAllEnabled?: boolean;
  toolExclusions: string[];
  onToolExclusionsChange: (exclusions: string[]) => void;
  disabled?: boolean;
}

type ExpandedState = Record<string, boolean>;

const toolExclusionKey = (serverId: string, toolName: string) => `${serverId}:${toolName}`;

export function McpLibraryToolSelector({
  selectedServerIds,
  useAllEnabled = false,
  toolExclusions,
  onToolExclusionsChange,
  disabled = false,
}: McpLibraryToolSelectorProps) {
  const { data: servers = [], isLoading, error: serversError } = useMcpServers();
  const { data: tools = [], error: toolsError } = useMcpAllTools();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [isRefreshing, setIsRefreshing] = useState(false);

  const selectedServers = useMemo(() => {
    const selectedIds = new Set(selectedServerIds);
    return servers.filter(
      (server) => server.enabled && (useAllEnabled || selectedIds.has(server.id)),
    );
  }, [selectedServerIds, servers, useAllEnabled]);

  const selectedServerIdSet = useMemo(
    () => new Set(selectedServers.map((server) => server.id)),
    [selectedServers],
  );
  const selectedTools = useMemo(
    () => tools.filter((tool) => selectedServerIdSet.has(tool.serverId)),
    [selectedServerIdSet, tools],
  );
  const exclusionSet = useMemo(() => new Set(toolExclusions), [toolExclusions]);
  const serversWithPersistedTools = useMemo(
    () => new Set(selectedTools.map((tool) => tool.serverId)),
    [selectedTools],
  );
  const hasRuntimeDiscoveredTools = selectedServers.some(
    (server) => !serversWithPersistedTools.has(server.id),
  );
  const finalEnabledCount = useMemo(
    () =>
      selectedTools.filter(
        (tool) => tool.enabled && !exclusionSet.has(toolExclusionKey(tool.serverId, tool.toolName)),
      ).length,
    [exclusionSet, selectedTools],
  );

  const handleRefresh = async () => {
    if (disabled || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() }),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleToolToggle = (serverId: string, toolName: string) => {
    if (disabled) return;
    const key = toolExclusionKey(serverId, toolName);
    onToolExclusionsChange(
      exclusionSet.has(key)
        ? toolExclusions.filter((exclusion) => exclusion !== key)
        : [...toolExclusions, key],
    );
  };

  const error = serversError ?? toolsError;
  if (isLoading && servers.length === 0) {
    return <div className="py-2 text-xs text-muted-foreground">Loading MCP tools...</div>;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />
        <span>{error.message}</span>
      </div>
    );
  }

  if (selectedServers.length === 0) {
    return (
      <div className="py-2 text-xs text-muted-foreground">
        Select an enabled MCP server above to configure its tools.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {hasRuntimeDiscoveredTools
            ? `${finalEnabledCount} known tool${
                finalEnabledCount === 1 ? '' : 's'
              } enabled; additional tools discovered at runtime`
            : `${finalEnabledCount} tool${finalEnabledCount === 1 ? '' : 's'} enabled`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={handleRefresh}
          disabled={disabled || isRefreshing}
          title="Refresh MCP tools"
          aria-label="Refresh MCP tools"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
        </Button>
      </div>

      <div className="max-h-64 space-y-1 overflow-y-auto">
        {selectedServers.map((server) => {
          const serverTools = selectedTools.filter((tool) => tool.serverId === server.id);
          const isExpanded = expanded[server.id] ?? false;
          const enabledToolCount = serverTools.filter((tool) => tool.enabled).length;

          return (
            <div key={server.id} className="rounded-md border">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((current) => ({
                      ...current,
                      [server.id]: !isExpanded,
                    }))
                  }
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  aria-label={`${isExpanded ? 'Hide' : 'Show'} tools for ${server.name}`}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={server.name}>
                  {server.name}
                </span>
                <Badge variant="outline" className="px-1 py-0 text-[9px]">
                  {server.transportType}
                </Badge>
                <Badge variant="secondary" className="px-1 py-0 text-[9px]">
                  {enabledToolCount}/{serverTools.length}
                </Badge>
              </div>

              {isExpanded && (
                <div className="space-y-1 border-t bg-muted/30 px-2 py-1.5">
                  {serverTools.length === 0 ? (
                    <span className="pl-6 text-[10px] text-muted-foreground">
                      No persisted tools. Live discovery remains available at run time.
                    </span>
                  ) : (
                    serverTools.map((tool) => {
                      const key = toolExclusionKey(server.id, tool.toolName);
                      const workflowExcluded = exclusionSet.has(key);
                      const unavailable = !tool.enabled;
                      const checkboxDisabled = disabled || unavailable;

                      return (
                        <div key={tool.id} className="flex items-center gap-2 pl-6">
                          <Checkbox
                            id={`tool-${tool.id}`}
                            aria-label={`${tool.toolName} on ${server.name}`}
                            checked={tool.enabled && !workflowExcluded}
                            onCheckedChange={() =>
                              !checkboxDisabled && handleToolToggle(server.id, tool.toolName)
                            }
                            disabled={checkboxDisabled}
                            className="h-3 w-3"
                          />
                          <Wrench className="h-3 w-3 text-muted-foreground" />
                          <label
                            htmlFor={`tool-${tool.id}`}
                            className={cn(
                              'min-w-0 flex-1 truncate text-[11px]',
                              !checkboxDisabled && 'cursor-pointer',
                              (workflowExcluded || unavailable) &&
                                'text-muted-foreground line-through',
                            )}
                            title={tool.description ?? tool.toolName}
                          >
                            {tool.toolName}
                          </label>
                          {unavailable && (
                            <Badge
                              variant="outline"
                              className="px-1 py-0 text-[9px] text-muted-foreground"
                            >
                              Globally disabled
                            </Badge>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
