import { Badge } from '@/components/ui/badge';
import type { NodeVisualState } from '@/store/executionTimelineStore';

export interface NodeStatusMessagesProps {
  isTimelineActive: boolean;
  visualState: NodeVisualState;
  nodeStatus: string | undefined;
  executionTime: number | undefined;
  error: string | undefined;
}

/**
 * Renders the last-event message (timeline mode) and legacy success/error badges.
 */
export function NodeStatusMessages({
  isTimelineActive,
  visualState,
  nodeStatus,
  executionTime,
  error,
}: NodeStatusMessagesProps) {
  return (
    <>
      {/* Timeline last-event info */}
      {isTimelineActive && (
        <div className="pt-2 border-t border-border/50">
          {visualState.lastEvent && (
            <div className="text-xs text-muted-foreground mt-2">
              <div className="font-medium">
                Last: {visualState.lastEvent.type.replace('_', ' ')}
              </div>
              {visualState.lastEvent.message && (
                <div className="truncate mt-1" title={visualState.lastEvent.message}>
                  {visualState.lastEvent.message}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legacy status messages */}
      {!isTimelineActive && nodeStatus === 'success' && executionTime && (
        <div className="pt-2 border-t border-border">
          <Badge
            variant="secondary"
            className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
          >
            ✓ {executionTime}ms
          </Badge>
        </div>
      )}
      {!isTimelineActive && nodeStatus === 'error' && error && (
        <div className="pt-2 border-t border-red-200">
          <Badge
            variant="secondary"
            className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 truncate max-w-full"
            title={error}
          >
            ✗ {error}
          </Badge>
        </div>
      )}
    </>
  );
}
