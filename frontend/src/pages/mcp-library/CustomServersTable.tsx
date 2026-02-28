import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Package, Plug, Plus, Wrench, Edit3, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TransportType, ToolCounts } from './types';
import { HealthIndicator } from './HealthIndicator';
import { TransportBadge } from './TransportBadge';
import { ConnectionCell } from './ConnectionCell';
import { ServerTableHeader } from './ServerTableHeader';
import type { McpHealthStatus } from '@shipsec/shared';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableTableRow, DragHandle } from '@/components/ui/sortable';

interface CustomServer {
  id: string;
  name: string;
  description?: string | null;
  transportType: TransportType;
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  enabled: boolean;
  lastHealthStatus?: McpHealthStatus | null;
}

interface CustomServersTableProps {
  servers: CustomServer[];
  isLoading: boolean;
  searchQuery: string;
  checkingServers: Set<string>;
  testingServer: string | null;
  toolCountsByServer: Record<string, ToolCounts>;
  onCreateNew: () => void;
  onToggle: (serverId: string) => void;
  onViewTools: (serverId: string) => void;
  onTestConnection: (serverId: string) => void;
  onEdit: (serverId: string) => void;
  onDelete: (serverId: string) => void;
  // Drag-to-reorder props
  sensors: ReturnType<typeof import('@dnd-kit/core').useSensors>;
  collisionDetection: typeof import('@dnd-kit/core').closestCenter;
  onDragEnd: (event: DragEndEvent) => void;
  isDragDisabled: boolean;
}

export function CustomServersTable({
  servers,
  isLoading,
  searchQuery,
  checkingServers,
  testingServer,
  toolCountsByServer,
  onCreateNew,
  onToggle,
  onViewTools,
  onTestConnection,
  onEdit,
  onDelete,
  sensors,
  collisionDetection,
  onDragEnd,
  isDragDisabled,
}: CustomServersTableProps) {
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <Package className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Custom MCP Servers</h2>
        <Badge variant="secondary" className="text-xs">
          {servers.length} {servers.length === 1 ? 'server' : 'servers'}
        </Badge>
      </div>
      <div className="border rounded-lg">
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
          <Table>
            <ServerTableHeader showDragHandle />
            <TableBody>
              {isLoading && servers.length === 0 ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-4" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-10 mx-auto" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-10 mx-auto" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-24 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : servers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <Plug className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">
                      {searchQuery
                        ? 'No servers match your search'
                        : 'No custom servers configured'}
                    </p>
                    {!searchQuery && (
                      <Button variant="outline" className="mt-4" onClick={onCreateNew}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add your first custom server
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                <SortableContext
                  items={servers.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {servers.map((server) => (
                    <SortableTableRow key={server.id} id={server.id} disabled={isDragDisabled}>
                      {({ handleProps }) => (
                        <>
                          <DragHandle {...handleProps} disabled={isDragDisabled} />
                          <TableCell>
                            <div>
                              <div className="font-medium">{server.name}</div>
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
                              status={server.lastHealthStatus ?? null}
                              checking={checkingServers.has(server.id)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            {toolCountsByServer[server.id]?.total > 0 ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Badge variant="outline" className="font-mono text-xs">
                                      {toolCountsByServer[server.id].enabled}/
                                      {toolCountsByServer[server.id].total}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>
                                      {toolCountsByServer[server.id].enabled} enabled out of{' '}
                                      {toolCountsByServer[server.id].total} tools
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
                              onCheckedChange={() => onToggle(server.id)}
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
                                      onClick={() => onViewTools(server.id)}
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
                                      aria-label="Test connection"
                                      onClick={() => onTestConnection(server.id)}
                                      disabled={testingServer === server.id}
                                    >
                                      <Plug
                                        className={cn(
                                          'h-4 w-4',
                                          testingServer === server.id && 'animate-pulse',
                                        )}
                                      />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Test connection</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>

                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label="Edit server"
                                      onClick={() => onEdit(server.id)}
                                    >
                                      <Edit3 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>

                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label="Delete server"
                                      onClick={() => onDelete(server.id)}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </TableCell>
                        </>
                      )}
                    </SortableTableRow>
                  ))}
                </SortableContext>
              )}
            </TableBody>
          </Table>
        </DndContext>
      </div>
    </>
  );
}
