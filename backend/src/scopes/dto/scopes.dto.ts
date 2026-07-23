import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateScopeSchema = z.object({
  name: z.string().min(1).max(191),
  description: z.string().max(2000).nullish(),
  domains: z.array(z.string()).default([]),
  repos: z.array(z.string()).default([]),
  ipRanges: z.array(z.string()).default([]),
  runtimeValues: z.record(z.string(), z.unknown()).default({}),
});

export class CreateScopeDto extends createZodDto(CreateScopeSchema) {}

export const UpdateScopeSchema = z.object({
  name: z.string().min(1).max(191).optional(),
  description: z.string().max(2000).nullish(),
  domains: z.array(z.string()).optional(),
  repos: z.array(z.string()).optional(),
  ipRanges: z.array(z.string()).optional(),
  runtimeValues: z.record(z.string(), z.unknown()).optional(),
});

export class UpdateScopeDto extends createZodDto(UpdateScopeSchema) {}

export const ScopeResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  domains: z.array(z.string()),
  repos: z.array(z.string()),
  ipRanges: z.array(z.string()),
  runtimeValues: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class ScopeResponse extends createZodDto(ScopeResponseSchema) {}
