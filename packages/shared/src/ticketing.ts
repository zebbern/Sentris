import { z } from 'zod';

import { FindingTriageStatusSchema } from './finding-triage.js';

// --- Enums ---

export const TICKETING_PROVIDERS = ['jira'] as const;
export const TicketingProviderSchema = z.enum(TICKETING_PROVIDERS);
export type TicketingProvider = z.infer<typeof TicketingProviderSchema>;

export const TICKET_SYNC_STATUSES = ['synced', 'pending', 'error', 'unknown'] as const;
export const TicketSyncStatusSchema = z.enum(TICKET_SYNC_STATUSES);
export type TicketSyncStatus = z.infer<typeof TicketSyncStatusSchema>;

// --- Status mapping ---

export const JiraStatusMappingTargetSchema = z.object({
  transitionName: z.string().min(1),
  resultingStatus: z.string().min(1),
});
export type JiraStatusMappingTarget = z.infer<typeof JiraStatusMappingTargetSchema>;

export const JiraStatusMappingEntrySchema = z.union([
  z.string().min(1),
  JiraStatusMappingTargetSchema,
]);
export type JiraStatusMappingEntry = z.infer<typeof JiraStatusMappingEntrySchema>;

export const JiraStatusMappingSchema = z.record(z.string(), JiraStatusMappingEntrySchema);
export type JiraStatusMapping = z.infer<typeof JiraStatusMappingSchema>;

export function normalizeJiraStatusMappingEntry(
  entry: JiraStatusMappingEntry,
): JiraStatusMappingTarget {
  return typeof entry === 'string' ? { transitionName: entry, resultingStatus: entry } : entry;
}

export const DEFAULT_JIRA_STATUS_MAPPING: Record<string, string> = {
  triaged: 'Open',
  in_progress: 'In Progress',
  fixed: 'Done',
  verified: 'Done',
  wont_fix: "Won't Do",
  accepted_risk: "Won't Do",
};

// --- Connection config ---

export const TicketingConnectionConfigSchema = z.object({
  projectKey: z.string().min(1).max(32),
  issueTypeId: z.string().min(1),
  statusMapping: JiraStatusMappingSchema,
  autoCreateOnStatuses: z.array(FindingTriageStatusSchema).min(1),
});
export type TicketingConnectionConfig = z.infer<typeof TicketingConnectionConfigSchema>;

// --- Response schemas ---

const TicketLinkResponseBaseSchema = z.object({
  id: z.string().uuid(),
  findingTriageId: z.string().uuid(),
  provider: TicketingProviderSchema,
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const ResolvedTicketLinkResponseSchema = TicketLinkResponseBaseSchema.extend({
  externalId: z.string().min(1),
  externalUrl: z.string().url(),
  syncStatus: z.enum(['synced', 'error']),
  reconciliationRequired: z.literal(false),
});

export const UnresolvedTicketLinkResponseSchema = TicketLinkResponseBaseSchema.extend({
  externalId: z.null(),
  externalUrl: z.null(),
  syncStatus: z.enum(['pending', 'unknown']),
  reconciliationRequired: z.literal(true),
});

export const TicketLinkResponseSchema = z.discriminatedUnion('reconciliationRequired', [
  ResolvedTicketLinkResponseSchema,
  UnresolvedTicketLinkResponseSchema,
]);
export type TicketLinkResponse = z.infer<typeof TicketLinkResponseSchema>;

export const TicketingConnectionStatusSchema = z.object({
  id: z.string().uuid().nullable(),
  provider: TicketingProviderSchema,
  isConnected: z.boolean(),
  cloudId: z.string().nullable(),
  config: TicketingConnectionConfigSchema.nullable(),
  createdAt: z.string().nullable(),
  webhookRegistration: z
    .object({
      status: z.enum(['unregistered', 'pending', 'registered', 'dead']),
      version: z.number().int().nonnegative(),
      lastError: z.string().nullable(),
    })
    .nullable(),
});
export type TicketingConnectionStatus = z.infer<typeof TicketingConnectionStatusSchema>;

// --- Request schemas ---

export const ConfigureTicketingSchema = TicketingConnectionConfigSchema;
export type ConfigureTicketing = z.infer<typeof ConfigureTicketingSchema>;

export const ConnectTicketingSchema = z.object({
  redirectUri: z.string().url(),
});
export type ConnectTicketing = z.infer<typeof ConnectTicketingSchema>;

const JiraIssueKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*$/)
  .transform((value) => value.toUpperCase());

export const ReconcileTicketCreationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('attach'),
      issueKey: JiraIssueKeySchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('clear_and_retry'),
      confirmedNoIssueExists: z.literal(true),
    })
    .strict(),
]);
export type ReconcileTicketCreation = z.infer<typeof ReconcileTicketCreationSchema>;

export const ReconcileTicketCreationResponseSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('attach'),
    status: z.literal('attached'),
    findingTriageId: z.string().uuid(),
    ticket: ResolvedTicketLinkResponseSchema,
  }),
  z.object({
    action: z.literal('clear_and_retry'),
    status: z.literal('retry_queued'),
    findingTriageId: z.string().uuid(),
    ticket: z.null(),
  }),
]);
export type ReconcileTicketCreationResponse = z.infer<typeof ReconcileTicketCreationResponseSchema>;

// --- Event payload ---

export interface FindingTriageChangedEvent {
  findingTriageId: string;
  findingOpensearchId: string;
  organizationId: string;
  projectionVersion: number;
  status: string;
  previousStatus: string;
  source: 'user' | 'jira_webhook';
  userId?: string;
}
