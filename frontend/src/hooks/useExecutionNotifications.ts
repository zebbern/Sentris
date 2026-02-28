import { useEffect, useRef } from 'react';
import { useExecutionStore, type TrackedRun } from '@/store/executionStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { useToast } from '@/components/ui/use-toast';

/**
 * Watches tracked runs in the execution store and shows toast notifications
 * when runs transition to terminal states, gated by user preferences.
 */
export function useExecutionNotifications(): void {
  const { toast } = useToast();
  const trackedRuns = useExecutionStore((s) => s.trackedRuns);
  const prevStatusRef = useRef<Map<string, TrackedRun['status']>>(new Map());

  useEffect(() => {
    const prev = prevStatusRef.current;
    const prefs = useUserPreferencesStore.getState();

    for (const run of trackedRuns) {
      const prevStatus = prev.get(run.runId);

      // First time we see this run — record status but don't notify
      if (prevStatus === undefined) continue;

      // No change
      if (prevStatus === run.status) continue;

      const label = run.workflowName ?? `Run ${run.runId.slice(0, 8)}`;

      if (run.status === 'completed' && prefs.notifyOnRunComplete) {
        toast({
          title: 'Workflow completed',
          description: `"${label}" finished successfully.`,
          variant: 'success',
        });
      }

      if (run.status === 'failed' && prefs.notifyOnRunFailed) {
        toast({
          title: 'Workflow failed',
          description: `"${label}" encountered an error.`,
          variant: 'destructive',
        });
      }
    }

    // Rebuild status map
    const next = new Map<string, TrackedRun['status']>();
    for (const run of trackedRuns) {
      next.set(run.runId, run.status);
    }
    prevStatusRef.current = next;
  }, [trackedRuns, toast]);
}
