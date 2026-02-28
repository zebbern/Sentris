import { Loader2, History as LucideHistory } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { NavigateFunction } from 'react-router-dom';
import type { WebhookDelivery } from '@shipsec/shared';

interface WebhookDeliveryLogProps {
  deliveries: WebhookDelivery[];
  isLoadingDeliveries: boolean;
  navigate: NavigateFunction;
}

export function WebhookDeliveryLog({
  deliveries,
  isLoadingDeliveries,
  navigate,
}: WebhookDeliveryLogProps) {
  if (isLoadingDeliveries) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (deliveries.length > 0) {
    return (
      <div className="border rounded-md">
        <div className="grid grid-cols-4 gap-4 p-4 border-b bg-muted/40 font-medium text-sm">
          <div>Status</div>
          <div>Run ID</div>
          <div>Timestamp</div>
          <div className="text-right">Action</div>
        </div>
        {deliveries.map((delivery) => (
          <div
            key={delivery.id}
            className="grid grid-cols-4 gap-4 p-4 border-b last:border-0 items-center text-sm"
          >
            <div className="flex items-center gap-2">
              {delivery.status === 'delivered' ? (
                <Badge className="bg-emerald-500 hover:bg-emerald-600">Success</Badge>
              ) : (
                <Badge variant="destructive">Failed</Badge>
              )}
            </div>
            <div className="font-mono text-xs">{delivery.workflowRunId || '-'}</div>
            <div className="text-muted-foreground">
              {new Date(delivery.createdAt).toLocaleString()}
            </div>
            <div className="text-right">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate(`/runs/${delivery.workflowRunId}`)}
                disabled={!delivery.workflowRunId}
              >
                View Run
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4 py-12">
      <LucideHistory className="h-12 w-12 opacity-20" />
      <p>No deliveries found for this webhook.</p>
    </div>
  );
}
