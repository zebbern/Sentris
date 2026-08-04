import { useEffect, useRef } from 'react';

import type {
  OperatorLatestTurnSummary,
  OperatorSessionSummary,
  OperatorTurnStatus,
} from '@sentris/shared';

import { useToast } from '@/components/ui/use-toast';
import { useOperatorActivityStream } from '@/hooks/queries/useOperatorQueries';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { logger } from '@/lib/logger';
import { useNotificationStore, type NotificationItem } from '@/store/notificationStore';

interface OperatorTransition {
  session: OperatorSessionSummary;
  turn: OperatorLatestTurnSummary;
}

type LatestTurnBySession = Map<string, OperatorLatestTurnSummary | null>;

const NOTIFIABLE_OPERATOR_STATUSES = new Set<OperatorTurnStatus>([
  'awaiting_approval',
  'completed',
  'failed',
]);

export function projectOperatorTransitions(
  previous: ReadonlyMap<string, OperatorLatestTurnSummary | null> | null,
  sessions: OperatorSessionSummary[],
): { next: LatestTurnBySession; transitions: OperatorTransition[] } {
  const next: LatestTurnBySession = new Map();
  const transitions: OperatorTransition[] = [];

  for (const session of sessions) {
    const latestTurn = session.latestTurn ?? null;
    next.set(session.id, latestTurn);
    if (!previous?.has(session.id) || !latestTurn) continue;

    const previousTurn = previous.get(session.id);
    const changed = previousTurn?.id !== latestTurn.id || previousTurn.status !== latestTurn.status;
    if (changed && NOTIFIABLE_OPERATOR_STATUSES.has(latestTurn.status)) {
      transitions.push({ session, turn: latestTurn });
    }
  }

  return { next, transitions };
}

function notificationDetails(
  transition: OperatorTransition,
): Pick<NotificationItem, 'title' | 'description' | 'variant'> {
  const label = `“${transition.session.title}”`;
  switch (transition.turn.status) {
    case 'awaiting_approval':
      return {
        title: 'Operator needs approval',
        description: `${label} is waiting for your decision.`,
        variant: 'warning',
      };
    case 'completed':
      return {
        title: 'Operator finished',
        description: `${label} completed the current task.`,
        variant: 'success',
      };
    case 'failed':
      return {
        title: 'Operator task failed',
        description: `${label} stopped with an error and needs review.`,
        variant: 'destructive',
      };
    case 'queued':
    case 'running':
    case 'cancelled':
      throw new Error(`Status ${transition.turn.status} is not notifiable`);
    default: {
      const exhaustive: never = transition.turn.status;
      throw new Error(`Unsupported Operator turn status: ${String(exhaustive)}`);
    }
  }
}

function isViewingSession(sessionId: string): boolean {
  return window.location.pathname.replace(/\/$/, '') === `/operator/${sessionId}`;
}

export function useOperatorNotifications(): void {
  const { data: sessions } = useOperatorActivityStream();
  const { permission } = useNotificationPermission();
  const { toast } = useToast();
  const previousRef = useRef<LatestTurnBySession | null>(null);
  const notifiedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!sessions) return;
    const projection = projectOperatorTransitions(previousRef.current, sessions);
    previousRef.current = projection.next;

    for (const transition of projection.transitions) {
      const notifyKey = `${transition.turn.id}:${transition.turn.status}`;
      if (notifiedRef.current.has(notifyKey)) continue;
      notifiedRef.current.add(notifyKey);
      if (isViewingSession(transition.session.id)) continue;

      const details = notificationDetails(transition);
      const href = `/operator/${transition.session.id}?turnId=${transition.turn.id}`;
      useNotificationStore.getState().push({
        ...details,
        href,
        sessionId: transition.session.id,
        turnId: transition.turn.id,
      });

      if (permission === 'granted') {
        try {
          const notification = new Notification(details.title, {
            body: details.description,
            tag: `operator:${notifyKey}`,
            icon: '/favicon.ico',
          });
          notification.onclick = () => {
            window.focus();
            window.location.assign(href);
            notification.close();
          };
          continue;
        } catch (error: unknown) {
          logger.warn('[Operator notifications] Failed to create browser notification:', error);
        }
      }

      toast({
        title: details.title,
        description: details.description,
        ...(details.variant === 'warning' ? {} : { variant: details.variant }),
      });
    }
  }, [permission, sessions, toast]);
}
