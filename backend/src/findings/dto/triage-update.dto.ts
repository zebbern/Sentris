import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FINDING_TRIAGE_STATUSES = [
  'new',
  'triaged',
  'in_progress',
  'fixed',
  'verified',
  'wont_fix',
  'accepted_risk',
] as const;

export type FindingTriageStatus = (typeof FINDING_TRIAGE_STATUSES)[number];

export const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low', 'info'] as const;

export const TriageUpdateSchema = z
  .object({
    status: z.enum(FINDING_TRIAGE_STATUSES).optional(),
    assigneeUserId: z.string().max(191).optional(),
    severityOverride: z.enum(SEVERITY_VALUES).optional().nullable(),
    notes: z.string().max(10_000).optional().nullable(),
    comment: z.string().max(2_000).optional(),
  })
  .refine(
    (data) =>
      data.status !== undefined ||
      data.assigneeUserId !== undefined ||
      data.severityOverride !== undefined ||
      data.notes !== undefined,
    {
      message:
        'At least one of status, assigneeUserId, severityOverride, or notes must be provided',
    },
  );

export class TriageUpdateDto extends createZodDto(TriageUpdateSchema) {}

export const TriageResponseSchema = z.object({
  id: z.string().uuid(),
  findingOpensearchId: z.string(),
  status: z.enum(FINDING_TRIAGE_STATUSES),
  assigneeUserId: z.string().nullable(),
  severityOverride: z.string().nullable(),
  notes: z.string().nullable(),
  slaDeadline: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TriageResponse = z.infer<typeof TriageResponseSchema>;
