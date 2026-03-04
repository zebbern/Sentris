import type {
  NotificationChannel,
  NotificationDelivery,
  CreateNotificationChannel,
  UpdateNotificationChannel,
} from '@sentris/shared';
import { httpGet, httpPost, httpPut, httpDel } from './client';

const BASE = '/notifications/channels';

export const notificationChannelsApi = {
  list: () => httpGet<NotificationChannel[]>(BASE),

  get: (id: string) => httpGet<NotificationChannel>(`${BASE}/${id}`),

  create: (payload: CreateNotificationChannel) => httpPost<NotificationChannel>(BASE, payload),

  update: (id: string, payload: UpdateNotificationChannel) =>
    httpPut<NotificationChannel>(`${BASE}/${id}`, payload),

  delete: (id: string) => httpDel(`${BASE}/${id}`),

  testChannel: (id: string) => httpPost<undefined>(`${BASE}/${id}/test`),

  listDeliveries: (id: string, params?: { limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return httpGet<NotificationDelivery[]>(`${BASE}/${id}/deliveries${qs ? `?${qs}` : ''}`);
  },

  resendDelivery: (channelId: string, deliveryId: string) =>
    httpPost<NotificationDelivery>(`${BASE}/${channelId}/deliveries/${deliveryId}/resend`),
};
