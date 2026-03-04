import { z } from 'zod';

// --- Enums ---

export const FINDING_TRIAGE_STATUSES = [
  'new',
  'triaged',
  'in_progress',
  'fixed',
  'verified',
  'wont_fix',
  'accepted_risk',
] as const;
export const FindingTriageStatusSchema = z.enum(FINDING_TRIAGE_STATUSES);
export type FindingTriageStatus = z.infer<typeof FindingTriageStatusSchema>;

export const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const SeveritySchema = z.enum(SEVERITY_VALUES);
export type Severity = z.infer<typeof SeveritySchema>;

// --- Request schemas ---

export const UpdateFindingTriageSchema = z
  .object({
    status: FindingTriageStatusSchema.optional(),
    assigneeUserId: z.string().max(191).optional(),
    severityOverride: SeveritySchema.optional().nullable(),
    notes: z.string().max(10_000).optional().nullable(),
    comment: z.string().max(2_000).optional(),
  })
  .refine(
    (data) =>
      data.status !== undefined ||
      data.assigneeUserId !== undefined ||
      data.severityOverride !== undefined ||
      data.notes !== undefined,
    { message: 'At least one of status, assigneeUserId, severityOverride, or notes must be provided' },
  );
export type UpdateFindingTriage = z.infer<typeof UpdateFindingTriageSchema>;

export const BulkTriageSchema = z
  .object({
    findingIds: z.array(z.string().max(512)).min(1).max(100),
    status: FindingTriageStatusSchema.optional(),
    assigneeUserId: z.string().max(191).optional(),
    comment: z.string().max(2_000).optional(),
  })
  .refine((data) => data.status !== undefined || data.assigneeUserId !== undefined, {
    message: 'At least one of status or assigneeUserId must be provided',
  });
export type BulkTriage = z.infer<typeof BulkTriageSchema>;

// --- Response schemas ---

export const FindingTriageResponseSchema = z.object({
  id: z.string().uuid(),
  findingOpensearchId: z.string(),
  status: FindingTriageStatusSchema,
  assigneeUserId: z.string().nullable(),
  severityOverride: z.string().nullable(),
  notes: z.string().nullable(),
  slaDeadline: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FindingTriageResponse = z.infer<typeof FindingTriageResponseSchema>;

export const FindingTriageEventResponseSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  fieldChanged: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  userId: z.string(),
  comment: z.string().nullable(),
  createdAt: z.string(),
});
export type FindingTriageEventResponse = z.infer<typeof FindingTriageEventResponseSchema>;

export const BulkTriageResultSchema = z.object({
  results: z.array(
    z.object({
      findingId: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
    }),
  ),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
});
export type BulkTriageResult = z.infer<typeof BulkTriageResultSchema>;

// --- State machine ---

export const VALID_TRANSITIONS: Record<FindingTriageStatus, readonly FindingTriageStatus[]> = {
  new: ['triaged', 'wont_fix', 'accepted_risk'],
  triaged: ['in_progress', 'wont_fix', 'accepted_risk'],
  in_progress: ['fixed', 'wont_fix', 'accepted_risk'],
  fixed: ['verified', 'in_progress'],
  verified: [],
  wont_fix: ['triaged'],
  accepted_risk: ['triaged'],
};
