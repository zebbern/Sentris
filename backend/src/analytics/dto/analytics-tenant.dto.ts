import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const EnsureTenantSchema = z.object({
  organizationId: z.string().trim().min(1),
});

export class EnsureTenantDto extends createZodDto(EnsureTenantSchema) {}
