import { z } from 'zod';

// --- Registry server types ---

export const RegistryServerTypeSchema = z.enum(['server', 'remote']);
export type RegistryServerType = z.infer<typeof RegistryServerTypeSchema>;

// --- Catalog query ---

export const RegistryCatalogQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  serverType: RegistryServerTypeSchema.optional(),
  featured: z.coerce.boolean().optional(),
  tags: z.string().optional(), // comma-separated
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type RegistryCatalogQuery = z.infer<typeof RegistryCatalogQuerySchema>;

// --- Catalog entry (list item) ---

export const RegistryCatalogEntrySchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  serverType: RegistryServerTypeSchema,
  category: z.string().nullable(),
  tags: z.array(z.string()),
  iconUrl: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  isFeatured: z.boolean(),
  hasSecrets: z.boolean(),
  hasOAuth: z.boolean(),
  isImported: z.boolean(),
});
export type RegistryCatalogEntry = z.infer<typeof RegistryCatalogEntrySchema>;

// --- Catalog detail (single entry, extends list item) ---

export const RegistryCatalogDetailSchema = RegistryCatalogEntrySchema.extend({
  dockerImage: z.string().nullable(),
  remoteConfig: z
    .object({
      transportType: z.enum(['streamable-http', 'sse']),
      url: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .nullable(),
  configRequirements: z.object({
    secrets: z
      .array(
        z.object({
          name: z.string(),
          env: z.string(),
          example: z.string().optional(),
        }),
      )
      .default([]),
    env: z
      .array(
        z.object({
          name: z.string(),
          example: z.string().optional(),
          value: z.string().optional(),
        }),
      )
      .default([]),
  }),
  oauthProviders: z
    .array(
      z.object({
        provider: z.string(),
        secret: z.string().optional(),
        env: z.string().optional(),
      }),
    )
    .default([]),
  runConfig: z
    .object({
      command: z.array(z.string()).optional(),
      volumes: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .nullable(),
});
export type RegistryCatalogDetail = z.infer<typeof RegistryCatalogDetailSchema>;

// --- Catalog list response ---

export const RegistryCatalogListResponseSchema = z.object({
  data: z.array(RegistryCatalogEntrySchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
  categories: z.array(z.string()),
});
export type RegistryCatalogListResponse = z.infer<typeof RegistryCatalogListResponseSchema>;

// --- Import request ---

export const RegistryImportRequestSchema = z.object({
  registryName: z.string().min(1),
  secrets: z.record(z.string(), z.string()).default({}),
  envVars: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
  groupId: z.string().uuid().optional(),
});
export type RegistryImportRequest = z.infer<typeof RegistryImportRequestSchema>;

// --- Import response ---

export const RegistryImportResponseSchema = z.object({
  serverId: z.string().uuid(),
  serverName: z.string(),
  transportType: z.enum(['http', 'stdio']),
  status: z.enum(['imported', 'already_exists']),
});
export type RegistryImportResponse = z.infer<typeof RegistryImportResponseSchema>;

// --- Sync status ---

export const RegistrySyncStatusSchema = z.object({
  lastSyncAt: z.string().datetime().nullable(),
  lastSyncStatus: z.string().nullable(),
  serversSynced: z.number(),
  serversAdded: z.number(),
  serversRemoved: z.number(),
  serversUpdated: z.number(),
  lastError: z.string().nullable(),
});
export type RegistrySyncStatus = z.infer<typeof RegistrySyncStatusSchema>;

// --- Sync trigger response ---

export const RegistrySyncResultSchema = z.object({
  status: z.enum(['success', 'skipped', 'partial', 'failed']),
  serversAdded: z.number(),
  serversUpdated: z.number(),
  serversRemoved: z.number(),
  totalServers: z.number(),
  durationMs: z.number(),
  error: z.string().nullable(),
});
export type RegistrySyncResult = z.infer<typeof RegistrySyncResultSchema>;
