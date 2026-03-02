import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ExportAuditLogsQuerySchema = z.object({
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  format: z.enum(['csv']).default('csv'),
});

export class ExportAuditLogsQueryDto extends createZodDto(ExportAuditLogsQuerySchema) {}
