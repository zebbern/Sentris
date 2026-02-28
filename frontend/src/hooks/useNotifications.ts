import { useEffect, useRef } from 'react';
import { useExecutionLifecycleStore, type ExecutionLifecycle } from '@/store/executionStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { useToast } from '@/components/ui/use-toast';
import { logger } from '@/lib/logger';

/**
 * Side-effect-only hook that subscribes to execution lifecycle events and
 * dispatches browser notifications (when granted) or in-app toasts (fallback)
 * based on user notification preferences.
 *
 * Uses store.subscribe() instead of a reactive selector so that polling
 * (which creates a new trackedRuns array ref every cycle) does not trigger
 * React re-renders in the AppLayout tree.
 *
 * Mount once at the AppLayout level so it listens regardless of which page
 * the user is on.
 */
export function useNotifications(): void {
  const { toast } = useToast();
  const { permission } = useNotificationPermission();

  // Track last-seen status per run to detect transitions
  const prevStatusRef = useRef<Map<string, ExecutionLifecycle>>(new Map());
  // Prevent duplicate notifications for the same run+status combination
  const notifiedRef = useRef<Set<string>>(new Set());

  // Keep permission in a ref so the effect doesn't re-run on permission changes alone
  const permissionRef = useRef(permission);
  permissionRef.current = permission;

  useEffect(() => {
    const unsub = useExecutionLifecycleStore.subscribe((state) => {
      const trackedRuns = state.trackedRuns;
      const prev = prevStatusRef.current;
      const prefs = useUserPreferencesStore.getState();
      const currentPermission = permissionRef.current;

      for (const run of trackedRuns) {
        const prevStatus = prev.get(run.runId);

        // First time we see this run — record status but don't notify
        if (prevStatus === undefined) continue;

        // No change
        if (prevStatus === run.status) continue;

        const isCompleted = run.status === 'completed';
        const isFailed = run.status === 'failed';

        if (!isCompleted && !isFailed) continue;

        // Check if user preference allows this notification
        if (isCompleted && !prefs.notifyOnRunComplete) continue;
        if (isFailed && !prefs.notifyOnRunFailed) continue;

        // Prevent duplicate notifications
        const notifyKey = `${run.runId}:${run.status}`;
        if (notifiedRef.current.has(notifyKey)) continue;
        notifiedRef.current.add(notifyKey);

        const label = run.workflowName ?? `Run ${run.runId.slice(0, 8)}`;

        if (currentPermission === 'granted') {
          // Browser notification
          try {
            const notification = new Notification(
              isCompleted ? 'Workflow completed' : 'Workflow failed',
              {
                body: isCompleted
                  ? `"${label}" finished successfully.`
                  : `"${label}" encountered an error.`,
                tag: notifyKey, // Prevents duplicate OS-level notifications
                icon: '/favicon.ico',
              },
            );
            notification.onclick = () => {
              window.focus();
              notification.close();
            };
          } catch (error: unknown) {
            logger.warn('[Notifications] Failed to create browser notification:', error);
            // Fall through to toast
            dispatchToast(toast, isCompleted, label);
          }
        } else {
          // Toast fallback when browser notifications are not granted
          dispatchToast(toast, isCompleted, label);
        }
      }

      // Rebuild status map from current tracked runs
      const next = new Map<string, ExecutionLifecycle>();
      for (const run of trackedRuns) {
        next.set(run.runId, run.status);
      }
      prevStatusRef.current = next;

      // Clean up stale entries from notifiedRef
      const activeRunIds = new Set(trackedRuns.map((r) => r.runId));
      for (const key of notifiedRef.current) {
        const runId = key.split(':')[0];
        if (!activeRunIds.has(runId)) {
          notifiedRef.current.delete(key);
        }
      }
    });

    return unsub;
  }, [toast]);
}

function dispatchToast(
  toast: ReturnType<typeof useToast>['toast'],
  isCompleted: boolean,
  label: string,
): void {
  toast({
    title: isCompleted ? 'Workflow completed' : 'Workflow failed',
    description: isCompleted
      ? `"${label}" finished successfully.`
      : `"${label}" encountered an error.`,
    variant: isCompleted ? 'success' : 'destructive',
  });
}
