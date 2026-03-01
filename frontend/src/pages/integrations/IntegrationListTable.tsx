import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plug, RefreshCcw, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

import { IntegrationStatusBadge } from './IntegrationStatusBadge';
import { formatTimestamp } from './utils';
import type { IntegrationProvider, IntegrationConnection } from './utils';

interface IntegrationListTableProps {
  connections: IntegrationConnection[];
  providers: IntegrationProvider[];
  isLoading: boolean;
  refreshingConnectionId: string | null;
  deletingConnectionId: string | null;
  connectingProvider: string | null;
  onRefresh: (connection: IntegrationConnection) => void;
  onDisconnect: (connection: IntegrationConnection) => void;
  onReconnect: (connection: IntegrationConnection) => void;
}

function ConnectionsTableSkeleton() {
  return (
    <div className="overflow-x-auto border rounded-lg">
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Scopes</TableHead>
            <TableHead className="hidden md:table-cell">Expires</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-[120px] mb-1" />
                <Skeleton className="h-3 w-[80px]" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-[60px] rounded-full" />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-[50px] rounded-full" />
                  <Skeleton className="h-5 w-[70px] rounded-full" />
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Skeleton className="h-4 w-[100px]" />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Skeleton className="h-8 w-8 rounded-md" />
                  <Skeleton className="h-8 w-8 rounded-md" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function IntegrationListTable({
  connections,
  providers,
  isLoading,
  refreshingConnectionId,
  deletingConnectionId,
  connectingProvider,
  onRefresh,
  onDisconnect,
  onReconnect,
}: IntegrationListTableProps) {
  if (isLoading && connections.length === 0) {
    return <ConnectionsTableSkeleton />;
  }

  if (!isLoading && connections.length === 0) {
    return (
      <div className="border rounded-lg bg-muted/30">
        <EmptyState
          icon={Plug}
          title="No active connections yet"
          description="Connect a provider below to start using OAuth-protected APIs in your workflows."
          className="py-10"
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border rounded-lg">
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Scopes</TableHead>
            <TableHead className="hidden md:table-cell">Expires</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {connections.map((connection) => {
            const isRefreshing = refreshingConnectionId === connection.id;
            const isDeleting = deletingConnectionId === connection.id;
            const provider = providers.find((item) => item.id === connection.provider);
            const canRefresh = connection.supportsRefresh && connection.hasRefreshToken;

            return (
              <TableRow key={connection.id}>
                <TableCell>
                  <div className="font-medium">{connection.providerName}</div>
                  <div className="text-xs text-muted-foreground">{connection.userId}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <IntegrationStatusBadge status={connection.status} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <div className="flex flex-wrap gap-2">
                    {connection.scopes.map((scope) => (
                      <Badge key={scope} variant="outline" className="text-[11px]">
                        {scope}
                      </Badge>
                    ))}
                    {connection.scopes.length === 0 && (
                      <span className="text-xs text-muted-foreground">(none)</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground hidden md:table-cell">
                  {formatTimestamp(connection.expiresAt ?? null)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2"
                      disabled={isRefreshing || !canRefresh}
                      onClick={() => onRefresh(connection)}
                    >
                      <RefreshCcw className="h-4 w-4" />
                      {isRefreshing ? 'Refreshing…' : 'Refresh'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2"
                      disabled={isDeleting}
                      onClick={() => onDisconnect(connection)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {isDeleting ? 'Removing…' : 'Remove'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => onReconnect(connection)}
                      disabled={
                        connectingProvider === connection.provider || !provider?.isConfigured
                      }
                    >
                      <Plug className="h-4 w-4" />
                      Reconnect
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
