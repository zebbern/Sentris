import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const SuccessfulWorkflowRunResultSchema = z.strictObject({
  outputs: z.record(z.string(), z.unknown()),
  success: z.literal(true),
});

const FailedWorkflowRunResultSchema = z.strictObject({
  status: z.literal('FAILED'),
  result: z.null(),
});

const CancelledWorkflowRunResultSchema = z.strictObject({
  status: z.literal('CANCELLED'),
  result: z.null(),
});

const TimedOutWorkflowRunResultSchema = z.strictObject({
  status: z.literal('TIMED_OUT'),
  result: z.null(),
});

const TerminatedWorkflowRunResultSchema = z.strictObject({
  status: z.literal('TERMINATED'),
  result: z.null(),
});

export const WorkflowRunResultResponseSchema = z.strictObject({
  runId: z.string(),
  result: z.union([
    SuccessfulWorkflowRunResultSchema,
    FailedWorkflowRunResultSchema,
    CancelledWorkflowRunResultSchema,
    TimedOutWorkflowRunResultSchema,
    TerminatedWorkflowRunResultSchema,
  ]),
});

export class WorkflowRunResultResponseDto extends createZodDto(WorkflowRunResultResponseSchema) {}

export const CancelWorkflowRunResponseSchema = z.strictObject({
  status: z.literal('cancelled'),
  runId: z.string(),
});

export class CancelWorkflowRunResponseDto extends createZodDto(CancelWorkflowRunResponseSchema) {}
