import { useState, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { History, ChevronDown, RotateCcw, Loader2 } from 'lucide-react';
import type { NotificationDelivery } from '@sentris/shared';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  useNotificationChannelDeliveries,
  useResendDelivery,
} from '@/hooks/queries/useNotificationChannelQueries';
import { useToast } from '@/components/ui/use-toast';
import { humanizeApiError } from '@/lib/humanizeApiError';

const PAGE_SIZE = 20;

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

function getHttpStatusVariant(status: number): 'success' | 'warning' | 'destructive' {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 400 && status < 500) return 'warning';
  return 'destructive';
}

export function ChannelDeliveryHistory({
  channelId,
  channelName,
  open,
  onOpenChange,
}: ChannelDeliveryHistoryProps) {
  const [offset, setOffset] = useState(0);
  const [accumulated, setAccumulated] = useState<NotificationDelivery[]>([]);
  const { toast } = useToast();
  const resendMutation = useResendDelivery();

  const {
    data: currentPage,
    isLoading,
    error,
    refetch,
  } = useNotificationChannelDeliveries(open ? channelId : undefined, {
    limit: PAGE_SIZE,
    offset,
  });

  // Merge accumulated pages with current page data
  const deliveries = useMemo(() => {
    if (!currentPage) return accumulated.length > 0 ? accumulated : undefined;
    // If offset is 0, this is the first (or refreshed) page
    if (offset === 0) return currentPage;
    // Otherwise, merge accumulated with current page (deduped by id)
    const seen = new Set(accumulated.map((d) => d.id));
    const newItems = currentPage.filter((d) => !seen.has(d.id));
    return [...accumulated, ...newItems];
  }, [accumulated, currentPage, offset]);

  const hasMore = currentPage ? currentPage.length >= PAGE_SIZE : false;

  const handleLoadMore = useCallback(() => {
    if (deliveries) {
      setAccumulated(deliveries);
    }
    setOffset((prev) => prev + PAGE_SIZE);
  }, [deliveries]);

  const handleResend = useCallback(
    (deliveryId: string) => {
      resendMutation.mutate(
        { channelId, deliveryId },
        {
          onSuccess: () => {
            toast({
              variant: 'success',
              title: 'Delivery re-sent successfully',
              description: 'A new delivery has been dispatched.',
            });
            // Reset pagination to refresh from the start
            setAccumulated([]);
            setOffset(0);
          },
          onError: (err) => {
            toast({
              variant: 'destructive',
              title: 'Failed to re-send delivery',
              description: humanizeApiError(err),
            });
          },
        },
      );
    },
    [channelId, resendMutation, toast],
  );

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
          {isLoading && offset === 0 && (
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

          {deliveries && deliveries.length > 0 && (
            <Accordion type="multiple" className="space-y-2">
              {deliveries.map((delivery) => (
                <AccordionItem
                  key={delivery.id}
                  value={delivery.id}
                  className="rounded-md border overflow-hidden"
                >
                  <AccordionTrigger className="hover:no-underline px-3 py-2.5 [&[data-state=open]>svg]:rotate-180">
                    <div className="flex items-center justify-between gap-2 flex-1 min-w-0 pr-2">
                      <span className="text-sm font-medium truncate">{delivery.eventType}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {delivery.durationMs != null && (
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            {delivery.durationMs}ms
                          </Badge>
                        )}
                        <Badge variant={STATUS_VARIANT[delivery.status] ?? 'default'}>
                          {delivery.status}
                        </Badge>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3 pt-1 space-y-3">
                    {/* Timestamps & error */}
                    <p className="text-xs text-muted-foreground">
                      Created {format(new Date(delivery.createdAt), 'MMM d, yyyy HH:mm:ss')}
                      {delivery.sentAt && (
                        <>
                          {' '}
                          &middot; Sent {format(new Date(delivery.sentAt), 'MMM d, yyyy HH:mm:ss')}
                        </>
                      )}
                    </p>
                    {delivery.errorMessage && (
                      <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
                        {delivery.errorMessage}
                      </p>
                    )}

                    {/* Request section */}
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1">Request</h4>
                      <pre className="text-xs bg-muted/50 rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap break-all">
                        {JSON.stringify(delivery.payload, null, 2)}
                      </pre>
                    </div>

                    {/* Response section */}
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1">Response</h4>
                      {delivery.responseStatus != null || delivery.responseBody != null ? (
                        <div className="space-y-1.5">
                          {delivery.responseStatus != null && (
                            <Badge variant={getHttpStatusVariant(delivery.responseStatus)}>
                              HTTP {delivery.responseStatus}
                            </Badge>
                          )}
                          {delivery.responseBody != null && (
                            <pre className="text-xs bg-muted/50 rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap break-all">
                              {delivery.responseBody}
                            </pre>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">
                          No response data captured
                        </p>
                      )}
                    </div>

                    {/* Resend button for failed deliveries */}
                    {delivery.status === 'failed' && (
                      <div className="pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resendMutation.isPending}
                          onClick={() => handleResend(delivery.id)}
                        >
                          {resendMutation.isPending &&
                          resendMutation.variables?.deliveryId === delivery.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          Resend
                        </Button>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}

          {/* Load more pagination */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" disabled={isLoading} onClick={handleLoadMore}>
                {isLoading && offset > 0 ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 mr-1.5" />
                )}
                Load more
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
