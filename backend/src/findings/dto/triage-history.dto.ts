import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TriageHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export class TriageHistoryQueryDto extends createZodDto(TriageHistoryQuerySchema) {}

export const TriageEventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  fieldChanged: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  userId: z.string(),
  comment: z.string().nullable(),
  createdAt: z.string(),
});

export type TriageEvent = z.infer<typeof TriageEventSchema>;

export const TriageHistoryResponseSchema = z.object({
  events: z.array(TriageEventSchema),
});

export type TriageHistoryResponse = z.infer<typeof TriageHistoryResponseSchema>;
