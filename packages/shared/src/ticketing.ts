import { z } from 'zod';

import { FindingTriageStatusSchema } from './finding-triage.js';

// --- Enums ---

export const TICKETING_PROVIDERS = ['jira'] as const;
export const TicketingProviderSchema = z.enum(TICKETING_PROVIDERS);
export type TicketingProvider = z.infer<typeof TicketingProviderSchema>;

export const TICKET_SYNC_STATUSES = ['synced', 'pending', 'error'] as const;
export const TicketSyncStatusSchema = z.enum(TICKET_SYNC_STATUSES);
export type TicketSyncStatus = z.infer<typeof TicketSyncStatusSchema>;

// --- Status mapping ---

export const JiraStatusMappingSchema = z.record(z.string(), z.string());
export type JiraStatusMapping = z.infer<typeof JiraStatusMappingSchema>;

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

export const TicketLinkResponseSchema = z.object({
  id: z.string().uuid(),
  findingTriageId: z.string().uuid(),
  provider: TicketingProviderSchema,
  externalId: z.string(),
  externalUrl: z.string().url(),
  syncStatus: TicketSyncStatusSchema,
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TicketLinkResponse = z.infer<typeof TicketLinkResponseSchema>;

export const TicketingConnectionStatusSchema = z.object({
  id: z.string().uuid().nullable(),
  provider: TicketingProviderSchema,
  isConnected: z.boolean(),
  cloudId: z.string().nullable(),
  config: TicketingConnectionConfigSchema.nullable(),
  createdAt: z.string().nullable(),
});
export type TicketingConnectionStatus = z.infer<typeof TicketingConnectionStatusSchema>;

// --- Request schemas ---

export const ConfigureTicketingSchema = TicketingConnectionConfigSchema;
export type ConfigureTicketing = z.infer<typeof ConfigureTicketingSchema>;

export const ConnectTicketingSchema = z.object({
  redirectUri: z.string().url(),
});
export type ConnectTicketing = z.infer<typeof ConnectTicketingSchema>;

// --- Event payload ---

export interface FindingTriageChangedEvent {
  findingTriageId: string;
  findingOpensearchId: string;
  organizationId: string;
  status: string;
  previousStatus: string;
  source: 'user' | 'jira_webhook';
  userId?: string;
}
