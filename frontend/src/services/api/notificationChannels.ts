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

  listDeliveries: (id: string) => httpGet<NotificationDelivery[]>(`${BASE}/${id}/deliveries`),
};
