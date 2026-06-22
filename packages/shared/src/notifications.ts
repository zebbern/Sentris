import { z } from 'zod';

import { isValidDiscordWebhookUrl } from './discord-webhook.js';

// --- Enums ---

export const NOTIFICATION_CHANNEL_TYPES = ['slack', 'discord', 'email', 'pagerduty'] as const;
export const NotificationChannelTypeSchema = z.enum(NOTIFICATION_CHANNEL_TYPES);
export type NotificationChannelType = z.infer<typeof NotificationChannelTypeSchema>;

export const NOTIFICATION_EVENT_TYPES = [
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.timed_out',
] as const;
export const NotificationEventTypeSchema = z.enum(NOTIFICATION_EVENT_TYPES);
export type NotificationEventType = z.infer<typeof NotificationEventTypeSchema>;

// --- Config schemas per channel type ---

const ALLOWED_SLACK_DOMAINS = ['hooks.slack.com', 'hooks.slack-gov.com'];

export const SlackChannelConfigSchema = z.object({
  webhookUrl: z.string().url().refine(
    (url) => {
      try {
        return ALLOWED_SLACK_DOMAINS.includes(new URL(url).hostname);
      } catch {
        return false;
      }
    },
    { message: 'Webhook URL must be a valid Slack webhook URL (hooks.slack.com)' },
  ),
});
export type SlackChannelConfig = z.infer<typeof SlackChannelConfigSchema>;

export const DiscordChannelConfigSchema = z.object({
  webhookUrl: z.string().url().refine(isValidDiscordWebhookUrl, {
    message:
      'Webhook URL must be a valid Discord webhook URL (https://discord.com/api/webhooks/...)',
  }),
});
export type DiscordChannelConfig = z.infer<typeof DiscordChannelConfigSchema>;

export const EmailChannelConfigSchema = z.object({
  recipients: z.array(z.string().email()).min(1),
});
export type EmailChannelConfig = z.infer<typeof EmailChannelConfigSchema>;

export const PagerDutyChannelConfigSchema = z.object({
  routingKey: z.string().min(1),
});
export type PagerDutyChannelConfig = z.infer<typeof PagerDutyChannelConfigSchema>;

// --- Channel response schema ---

export const NotificationChannelSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  name: z.string(),
  type: NotificationChannelTypeSchema,
  config: z.record(z.string(), z.unknown()),
  status: z.enum(['active', 'inactive']),
  events: z.array(NotificationEventTypeSchema),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

// --- Create / Update request schemas ---

export const CreateNotificationChannelSchema = z.object({
  name: z.string().min(1).max(255),
  type: NotificationChannelTypeSchema,
  config: z.record(z.string(), z.unknown()),
  events: z.array(NotificationEventTypeSchema).min(1),
});
export type CreateNotificationChannel = z.infer<typeof CreateNotificationChannelSchema>;

export const UpdateNotificationChannelSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  events: z.array(NotificationEventTypeSchema).min(1).optional(),
});
export type UpdateNotificationChannel = z.infer<typeof UpdateNotificationChannelSchema>;

// --- Delivery response schema ---

export const NotificationDeliverySchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  runId: z.string().nullable(),
  eventType: z.string(),
  status: z.enum(['pending', 'sent', 'failed']),
  payload: z.record(z.string(), z.unknown()),
  errorMessage: z.string().nullable(),
  durationMs: z.number().nullable(),
  responseStatus: z.number().nullable(),
  responseBody: z.string().nullable(),
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
});
export type NotificationDelivery = z.infer<typeof NotificationDeliverySchema>;

// --- Run lifecycle event payload (emitted internally) ---

export interface RunLifecycleEvent {
  runId: string;
  workflowId: string;
  organizationId: string;
  status: string;
  completedAt?: string;
}
