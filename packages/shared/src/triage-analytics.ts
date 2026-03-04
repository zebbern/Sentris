import { z } from 'zod';

import { FindingTriageStatusSchema, SeveritySchema } from './finding-triage.js';

// --- Posture Trend ---

export const PostureTrendBucketSchema = z.object({
  date: z.string(),
  critical: z.number().int(),
  high: z.number().int(),
  medium: z.number().int(),
  low: z.number().int(),
  info: z.number().int(),
});

export const PostureTrendResponseSchema = z.object({
  buckets: z.array(PostureTrendBucketSchema),
});
export type PostureTrendResponse = z.infer<typeof PostureTrendResponseSchema>;

// --- Triage Velocity ---

export const TriageVelocityBucketSchema = z.object({
  date: z.string(),
  new: z.number().int(),
  triaged: z.number().int(),
  in_progress: z.number().int(),
  fixed: z.number().int(),
  verified: z.number().int(),
  wont_fix: z.number().int(),
  accepted_risk: z.number().int(),
});

export const TriageVelocityResponseSchema = z.object({
  buckets: z.array(TriageVelocityBucketSchema),
});
export type TriageVelocityResponse = z.infer<typeof TriageVelocityResponseSchema>;

// --- MTTR ---

export const MttrSeveritySchema = z.object({
  severity: SeveritySchema,
  mttrSeconds: z.number().nullable(),
  resolvedCount: z.number().int(),
});

export const MttrResponseSchema = z.object({
  severities: z.array(MttrSeveritySchema),
});
export type MttrResponse = z.infer<typeof MttrResponseSchema>;

// --- SLA Compliance ---

export const SlaComplianceSeveritySchema = z.object({
  severity: SeveritySchema,
  totalWithSla: z.number().int(),
  metSla: z.number().int(),
  missedSla: z.number().int(),
  complianceRate: z.number().nullable(),
});

export const SlaComplianceResponseSchema = z.object({
  severities: z.array(SlaComplianceSeveritySchema),
});
export type SlaComplianceResponse = z.infer<typeof SlaComplianceResponseSchema>;

// --- Status Distribution ---

export const StatusDistributionEntrySchema = z.object({
  status: FindingTriageStatusSchema,
  count: z.number().int(),
});

export const StatusDistributionResponseSchema = z.object({
  statuses: z.array(StatusDistributionEntrySchema),
  total: z.number().int(),
});
export type StatusDistributionResponse = z.infer<typeof StatusDistributionResponseSchema>;

// --- Top Assignees ---

export const TopAssigneeEntrySchema = z.object({
  userId: z.string().nullable(),
  totalCount: z.number().int(),
  resolvedCount: z.number().int(),
  resolutionRate: z.number().nullable(),
});

export const TopAssigneesResponseSchema = z.object({
  assignees: z.array(TopAssigneeEntrySchema),
});
export type TopAssigneesResponse = z.infer<typeof TopAssigneesResponseSchema>;
