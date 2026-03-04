import { z } from 'zod';

import { SeveritySchema } from './finding-triage.js';

// --- Single SLA Policy ---

export const SlaPolicySchema = z.object({
  id: z.string().uuid(),
  severity: SeveritySchema,
  deadlineHours: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SlaPolicy = z.infer<typeof SlaPolicySchema>;

// --- Response: list of policies ---

export const SlaPoliciesResponseSchema = z.object({
  policies: z.array(SlaPolicySchema),
});
export type SlaPoliciesResponse = z.infer<typeof SlaPoliciesResponseSchema>;

// --- Request: upsert policies ---

export const UpsertSlaPolicyEntrySchema = z.object({
  severity: SeveritySchema,
  deadlineHours: z.number().int().min(1).max(8760),
});

export const UpsertSlaPoliciesSchema = z.object({
  policies: z.array(UpsertSlaPolicyEntrySchema).max(5),
});
export type UpsertSlaPolicies = z.infer<typeof UpsertSlaPoliciesSchema>;
