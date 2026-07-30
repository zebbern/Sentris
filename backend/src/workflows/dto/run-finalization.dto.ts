import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReportableTerminalStatusSchema = z.enum([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT',
]);

export const FinalizeRunRequestSchema = z.object({
  status: ReportableTerminalStatusSchema,
  completedAt: z.string().datetime().optional(),
});

export class FinalizeRunRequestDto extends createZodDto(FinalizeRunRequestSchema) {}
export type ReportableTerminalStatus = z.infer<typeof ReportableTerminalStatusSchema>;
