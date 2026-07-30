import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListDeadLettersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2048).optional(),
});

export class ListDeadLettersQueryDto extends createZodDto(ListDeadLettersQuerySchema) {}

export const OutboxDeadLetterSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  organizationId: z.string().nullable(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  dedupeKey: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: z.literal('dead'),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  availableAt: z.string().datetime(),
  lockedAt: z.string().datetime().nullable(),
  lockedBy: z.string().nullable(),
  lastError: z.string().nullable(),
  processedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class OutboxDeadLetterDto extends createZodDto(OutboxDeadLetterSchema) {}

export const ListDeadLettersResponseSchema = z.object({
  items: z.array(OutboxDeadLetterSchema),
  nextCursor: z.string().nullable(),
});

export class ListDeadLettersResponseDto extends createZodDto(ListDeadLettersResponseSchema) {}

export const RequeueDeadLetterResponseSchema = z.object({
  eventId: z.string().uuid(),
  status: z.literal('pending'),
});

export const OutboxEventIdSchema = z.string().uuid();

export const OutboxDeadLetterCursorPayloadSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

export class RequeueDeadLetterResponseDto extends createZodDto(RequeueDeadLetterResponseSchema) {}
