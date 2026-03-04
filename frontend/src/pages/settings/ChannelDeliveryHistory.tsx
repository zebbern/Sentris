import { format } from 'date-fns';
import { History } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useNotificationChannelDeliveries } from '@/hooks/queries/useNotificationChannelQueries';
import { humanizeApiError } from '@/lib/humanizeApiError';

interface ChannelDeliveryHistoryProps {
  channelId: string;
  channelName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'destructive' | 'warning'> = {
  sent: 'success',
  failed: 'destructive',
  pending: 'warning',
};

export function ChannelDeliveryHistory({
  channelId,
  channelName,
  open,
  onOpenChange,
}: ChannelDeliveryHistoryProps) {
  const {
    data: deliveries,
    isLoading,
    error,
    refetch,
  } = useNotificationChannelDeliveries(open ? channelId : undefined);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto"
        aria-label="Delivery history"
      >
        <SheetHeader>
          <SheetTitle>Delivery History</SheetTitle>
          <SheetDescription>
            Recent deliveries for <span className="font-medium">{channelName}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {isLoading && (
            <div className="space-y-3" role="status" aria-label="Loading deliveries">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-md border p-3 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              ))}
            </div>
          )}

          {error && <ErrorBanner message={humanizeApiError(error)} onRetry={() => refetch()} />}

          {!isLoading && !error && deliveries?.length === 0 && (
            <EmptyState
              icon={History}
              title="No deliveries yet"
              description="Deliveries will appear here once notifications are sent through this channel."
            />
          )}

          {deliveries?.map((delivery) => (
            <div key={delivery.id} className="rounded-md border p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{delivery.eventType}</span>
                <Badge variant={STATUS_VARIANT[delivery.status] ?? 'default'}>
                  {delivery.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Created {format(new Date(delivery.createdAt), 'MMM d, yyyy HH:mm:ss')}
                {delivery.sentAt && (
                  <> &middot; Sent {format(new Date(delivery.sentAt), 'MMM d, yyyy HH:mm:ss')}</>
                )}
              </p>
              {delivery.errorMessage && (
                <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
                  {delivery.errorMessage}
                </p>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
