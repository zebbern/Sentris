import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDuration, formatData } from './utils';
import type { EventDiagnosticsDialogProps } from './types';

export function EventDiagnosticsDialog({
  event,
  isOpen,
  onOpenChange,
  displayEvents,
  nodeState,
  relatedFlows,
}: EventDiagnosticsDialogProps) {
  if (!event) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Diagnostics - {event.type}</DialogTitle>
          <DialogDescription className="sr-only">
            Detailed diagnostics information for this event
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 rounded-md border border-dashed border-border/70 bg-muted/10 px-3 py-3 text-[11px] text-muted-foreground">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-[10px] uppercase tracking-wide">Event ID</span>
              <div className="mt-1 font-mono text-[11px] text-foreground break-all">{event.id}</div>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wide">Elapsed</span>
              <div className="mt-1 font-mono text-[11px] text-foreground">
                {displayEvents.length > 0
                  ? formatDuration(displayEvents[0].timestamp, event.timestamp)
                  : '—'}
              </div>
            </div>
            {event.metadata?.correlationId && (
              <div className="col-span-2">
                <span className="block text-[10px] uppercase tracking-wide">Correlation</span>
                <div className="mt-1 font-mono text-[11px] text-foreground break-all">
                  {event.metadata.correlationId}
                </div>
              </div>
            )}
            {event.metadata?.streamId && (
              <div>
                <span className="block text-[10px] uppercase tracking-wide">Stream</span>
                <div className="mt-1 font-mono text-[11px] text-foreground break-all">
                  {event.metadata.streamId}
                </div>
              </div>
            )}
            {event.metadata?.triggeredBy && (
              <div className="col-span-2">
                <span className="block text-[10px] uppercase tracking-wide">Triggered by</span>
                <div className="mt-1 font-mono text-[11px] text-foreground break-all">
                  {event.metadata.triggeredBy}
                </div>
              </div>
            )}
            {event.metadata?.retryPolicy && (
              <div className="col-span-2">
                <span className="block text-[10px] uppercase tracking-wide">Retry policy</span>
                <div className="mt-1 rounded border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px] space-y-1">
                  {event.metadata.retryPolicy.maxAttempts !== undefined && (
                    <div>maxAttempts: {event.metadata.retryPolicy.maxAttempts}</div>
                  )}
                  {event.metadata.retryPolicy.initialIntervalSeconds !== undefined && (
                    <div>
                      initialIntervalSeconds: {event.metadata.retryPolicy.initialIntervalSeconds}s
                    </div>
                  )}
                  {event.metadata.retryPolicy.maximumIntervalSeconds !== undefined && (
                    <div>
                      maximumIntervalSeconds: {event.metadata.retryPolicy.maximumIntervalSeconds}s
                    </div>
                  )}
                  {event.metadata.retryPolicy.backoffCoefficient !== undefined && (
                    <div>backoffCoefficient: {event.metadata.retryPolicy.backoffCoefficient}</div>
                  )}
                  {event.metadata.retryPolicy.nonRetryableErrorTypes &&
                    event.metadata.retryPolicy.nonRetryableErrorTypes.length > 0 && (
                      <div>
                        nonRetryableErrorTypes:{' '}
                        {event.metadata.retryPolicy.nonRetryableErrorTypes.join(', ')}
                      </div>
                    )}
                </div>
              </div>
            )}
            {event.metadata?.failure && (
              <div className="col-span-2">
                <span className="block text-[10px] uppercase tracking-wide font-bold text-destructive">
                  Failure context
                </span>
                <div className="mt-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive space-y-2">
                  {event.metadata.failure.at && (
                    <div>
                      <span className="opacity-70 font-semibold uppercase text-[9px]">At:</span>{' '}
                      {event.metadata.failure.at}
                    </div>
                  )}
                  {event.metadata.failure.reason?.type && (
                    <div>
                      <span className="opacity-70 font-semibold uppercase text-[9px]">Type:</span>{' '}
                      {event.metadata.failure.reason.type}
                    </div>
                  )}
                  <div>
                    <span className="opacity-70 font-semibold uppercase text-[9px]">Message:</span>{' '}
                    {event.metadata.failure.reason?.message}
                  </div>
                  {event.metadata.failure.reason?.details &&
                    Object.keys(event.metadata.failure.reason.details).length > 0 && (
                      <div>
                        <span className="opacity-70 font-semibold uppercase text-[9px] block mb-1">
                          Details:
                        </span>
                        <pre className="mt-1 rounded bg-black/5 dark:bg-white/5 p-1.5 font-mono text-[10px] overflow-auto max-h-32">
                          {formatData(event.metadata.failure.reason.details)}
                        </pre>
                      </div>
                    )}
                </div>
              </div>
            )}
          </div>

          {nodeState && (
            <div>
              <span className="block text-[10px] uppercase tracking-wide">Node state</span>
              <div className="mt-1 grid grid-cols-2 gap-3 text-muted-foreground">
                <div>
                  <span className="text-[10px] uppercase">Status</span>
                  <div className="font-mono text-[11px] text-foreground">{nodeState.status}</div>
                </div>
                <div>
                  <span className="text-[10px] uppercase">Progress</span>
                  <div className="font-mono text-[11px] text-foreground">
                    {Math.round(nodeState.progress)}%
                  </div>
                </div>
                {nodeState.retryCount > 0 && (
                  <div>
                    <span className="text-[10px] uppercase">Retries</span>
                    <div className="font-mono text-[11px] text-foreground">
                      {nodeState.retryCount}
                    </div>
                  </div>
                )}
                {nodeState.lastActivityId &&
                  nodeState.lastActivityId !== event.metadata?.activityId && (
                    <div className="col-span-2">
                      <span className="text-[10px] uppercase">Latest activity</span>
                      <div className="font-mono text-[11px] text-foreground break-all">
                        {nodeState.lastActivityId}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}

          {event.nodeId && (
            <div>
              <span className="block text-[10px] uppercase tracking-wide">Data flows</span>
              <div className="mt-1 space-y-1">
                {relatedFlows.slice(0, 5).map((flow, index) => (
                  <div
                    key={`${flow.sourceNode}-${flow.targetNode}-${index}`}
                    className="rounded border border-border/60 bg-background/60 px-2 py-1 text-[11px]"
                  >
                    <div className="font-medium text-foreground/90">
                      {flow.sourceNode} → {flow.targetNode}
                    </div>
                    <div className="text-muted-foreground">
                      {flow.type} • {(flow.size / 1024).toFixed(1)}KB
                    </div>
                  </div>
                ))}
                {relatedFlows.length === 0 && (
                  <div className="rounded border border-dashed border-border/60 bg-background/40 px-2 py-1 text-muted-foreground/80">
                    No data packets recorded for this event.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
