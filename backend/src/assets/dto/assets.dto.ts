import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AssetResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  scopeId: z.string().uuid(),
  assetType: z.enum([
    'subdomain',
    'host',
    'ip-address',
    'open-port',
    'http-probe',
    'dns-record',
    'crawled-url',
    'url',
  ]),
  assetValue: z.string(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  firstSeenRunId: z.string().nullable(),
  lastSeenRunId: z.string().nullable(),
  sourceComponentId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class AssetResponse extends createZodDto(AssetResponseSchema) {}
