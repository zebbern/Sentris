import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ConfigureTicketingSchema,
  ConnectTicketingSchema,
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

// --- Response DTOs ---

export class TicketingConnectionResponseDto extends createZodDto(TicketingConnectionStatusSchema) {}

export class TicketLinkResponseDto extends createZodDto(TicketLinkResponseSchema) {}

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
