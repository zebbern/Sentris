import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Cloud, HelpCircle, Package, Trash2, Wrench, RefreshCw, Loader } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { McpHealthStatus } from '@sentris/shared';
import type { ToolCounts } from './types';
import { getGroupTheme } from './utils';
import { GroupLogo } from './GroupLogo';
import { HealthIndicator } from './HealthIndicator';
import { TransportBadge } from './TransportBadge';
import { ConnectionCell } from './ConnectionCell';
import { ServerTableHeader } from './ServerTableHeader';

interface GroupServer {
  serverId: string;
  serverName: string;
  description?: string | null;
  transportType: 'http' | 'stdio';
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  enabled: boolean;
  healthStatus: McpHealthStatus;
  toolCount: number;
}

interface ImportedGroup {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  defaultDockerImage?: string | null;
}

interface ImportedGroupsSectionProps {
  groups: ImportedGroup[];
  isLoading: boolean;
  searchQuery: string;
  checkingServers: Set<string>;
  discoveringServerIds: Set<string>;
  getGroupServers: (groupId: string) => GroupServer[];
  getGroupServerHealthStatus: (server: {
    serverId: string;
    healthStatus: McpHealthStatus;
  }) => McpHealthStatus;
  getGroupServerToolCounts: (server: { serverId: string; toolCount: number }) => ToolCounts | null;
  onToggle: (serverId: string) => void;
  onViewTools: (serverId: string) => void;
  onDiscoverTools: (serverId: string, image?: string) => void;
  onRemoveGroup: (groupId: string, groupName: string) => void;
}

export function ImportedGroupsSection({
  groups,
  isLoading,
  searchQuery,
  checkingServers,
  discoveringServerIds,
  getGroupServers,
  getGroupServerHealthStatus,
  getGroupServerToolCounts,
  onToggle,
  onViewTools,
  onDiscoverTools,
  onRemoveGroup,
}: ImportedGroupsSectionProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <Package className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">MCP groups</h2>
        <Badge variant="secondary" className="text-xs">
          {groups.length} {groups.length === 1 ? 'group' : 'groups'}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="MCP groups help"
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Import curated MCP groups to auto-register servers and discover tools.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {isLoading && groups.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardHeader className="pb-4">
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-4 w-64" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-14 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Cloud className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              {searchQuery ? 'No imported groups match your search.' : 'No groups imported yet.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" className="space-y-3">
          {groups.map((group) => {
            const theme = getGroupTheme(group.slug);
            const groupServerList = getGroupServers(group.id);
            const serverCount = groupServerList.length;

            return (
              <AccordionItem
                key={group.id}
                value={group.id}
                className={cn('rounded-lg border overflow-hidden', theme.container)}
              >
                <AccordionTrigger
                  className={cn('hover:no-underline px-4 py-3', theme.headerBorder)}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className={cn('p-2 rounded-lg border', theme.iconWrapper)}>
                      <GroupLogo slug={group.slug} name={group.name} className={theme.iconText} />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold">{group.name}</h3>
                        <Badge variant="secondary" className="text-xs font-medium">
                          {serverCount} {serverCount === 1 ? 'server' : 'servers'}
                        </Badge>
                      </div>
                      {group.description && (
                        <p className="text-sm text-muted-foreground mt-0.5">{group.description}</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Delete group ${group.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onRemoveGroup(group.id, group.name);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  {serverCount === 0 ? (
                    <div className="border rounded-lg overflow-x-auto">
                      <Table>
                        <ServerTableHeader />
                        <TableBody>
                          <TableRow>
                            <TableCell colSpan={7} className="text-center py-8 text-sm">
                              <span className="text-muted-foreground">
                                No servers in this group
                              </span>
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-x-auto">
                      <Table>
                        <ServerTableHeader />
                        <TableBody>
                          {groupServerList.map((server) => {
                            const toolCounts = getGroupServerToolCounts(server);
                            const healthStatus = getGroupServerHealthStatus(server);

                            return (
                              <TableRow key={server.serverId}>
                                <TableCell>
                                  <div>
                                    <div className="font-medium">{server.serverName}</div>
                                    {server.description && (
                                      <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                                        {server.description}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <TransportBadge type={server.transportType} />
                                </TableCell>
                                <TableCell>
                                  <ConnectionCell
                                    connection={{
                                      endpoint: server.endpoint,
                                      command: server.command,
                                      args: server.args,
                                    }}
                                  />
                                </TableCell>
                                <TableCell>
                                  <HealthIndicator
                                    status={healthStatus}
                                    checking={checkingServers.has(server.serverId)}
                                  />
                                </TableCell>
                                <TableCell className="text-center">
                                  {toolCounts && toolCounts.total > 0 ? (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 px-2 font-mono text-xs"
                                            onClick={() => onViewTools(server.serverId)}
                                          >
                                            {toolCounts.enabled}/{toolCounts.total}
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>
                                            {toolCounts.enabled} enabled out of {toolCounts.total}{' '}
                                            tools
                                          </p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-center">
                                  <Switch
                                    checked={server.enabled}
                                    onCheckedChange={() => onToggle(server.serverId)}
                                  />
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label="View tools"
                                            onClick={() => onViewTools(server.serverId)}
                                          >
                                            <Wrench className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>View tools</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label="Rediscover tools"
                                            onClick={() =>
                                              onDiscoverTools(
                                                server.serverId,
                                                group.defaultDockerImage ?? undefined,
                                              )
                                            }
                                            disabled={discoveringServerIds.has(server.serverId)}
                                          >
                                            {discoveringServerIds.has(server.serverId) ? (
                                              <Loader className="h-4 w-4 animate-spin" />
                                            ) : (
                                              <RefreshCw className="h-4 w-4" />
                                            )}
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Rediscover tools</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
