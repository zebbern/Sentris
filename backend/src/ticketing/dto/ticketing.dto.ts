import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ConfigureTicketingSchema,
  ConnectTicketingSchema,
  ReconcileTicketCreationResponseSchema as SharedReconcileTicketCreationResponseSchema,
  ReconcileTicketCreationSchema as SharedReconcileTicketCreationSchema,
  TicketLinkResponseSchema,
  TicketingConnectionStatusSchema,
} from '@sentris/shared';

// --- Request DTOs ---

export class ConnectJiraDto extends createZodDto(ConnectTicketingSchema) {}

export const JiraCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().uuid(),
});
export class JiraCallbackQueryDto extends createZodDto(JiraCallbackQuerySchema) {}

export class UpdateTicketingConfigDto extends createZodDto(ConfigureTicketingSchema) {}

export const ReconcileTicketCreationSchema = SharedReconcileTicketCreationSchema;
const ReconcileTicketCreationDtoBase = createZodDto(
  ReconcileTicketCreationSchema,
) as unknown as new () => Record<string, unknown>;
export class ReconcileTicketCreationDto extends ReconcileTicketCreationDtoBase {}

// --- Response DTOs ---

export class TicketingConnectionResponseDto extends createZodDto(TicketingConnectionStatusSchema) {}

export const OAuthConnectResponseSchema = z.object({
  authorizationUrl: z.string().url(),
  state: z.string().uuid(),
});
export class OAuthConnectResponseDto extends createZodDto(OAuthConnectResponseSchema) {}

export const OperationSuccessResponseSchema = z.object({
  success: z.literal(true),
});
export class OperationSuccessResponseDto extends createZodDto(OperationSuccessResponseSchema) {}

export const TicketingErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
});
export class TicketingErrorResponseDto extends createZodDto(TicketingErrorResponseSchema) {}

export const JiraWebhookResponseSchema = z.object({
  status: z.enum(['ignored', 'unmapped_status', 'no_change', 'synced', 'error']),
});
export class JiraWebhookResponseDto extends createZodDto(JiraWebhookResponseSchema) {}

const TicketLinkResponseDtoBase = createZodDto(
  TicketLinkResponseSchema,
) as unknown as new () => Record<string, unknown>;
export class TicketLinkResponseDto extends TicketLinkResponseDtoBase {}

export const ReconcileTicketCreationResponseSchema = SharedReconcileTicketCreationResponseSchema;
const ReconcileTicketCreationResponseDtoBase = createZodDto(
  ReconcileTicketCreationResponseSchema,
) as unknown as new () => Record<string, unknown>;
export class ReconcileTicketCreationResponseDto extends ReconcileTicketCreationResponseDtoBase {}

export const JiraProjectSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export class JiraProjectDto extends createZodDto(JiraProjectSchema) {}

export const JiraIssueTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  iconUrl: z.string().nullable(),
});
export class JiraIssueTypeDto extends createZodDto(JiraIssueTypeSchema) {}
