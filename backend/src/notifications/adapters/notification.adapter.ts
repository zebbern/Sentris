import type { NotificationChannelRecord } from '../../database/schema';
import type { RunLifecycleEvent } from '@sentris/shared';

export interface NotificationAdapterResult {
  success: boolean;
  outcome?: 'accepted' | 'rejected' | 'unknown';
  error?: string;
  responseStatus?: number;
  responseBody?: string;
}

export abstract class NotificationAdapter {
  abstract send(
    channel: NotificationChannelRecord,
    payload: RunLifecycleEvent,
  ): Promise<NotificationAdapterResult>;
}
