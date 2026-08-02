import {
  ExecutionStatusSchema,
  ExecutionTriggerMetadataSchema,
  WorkflowGraphSchema,
  WorkflowNodeSchema,
  WorkflowRuntimeInputDefinitionObjectSchema,
} from '@sentris/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export {
  WorkflowEdgeSchema,
  WorkflowGraphSchema,
  WorkflowNodeDataSchema,
  WorkflowNodeSchema,
  WorkflowViewportSchema,
} from '@sentris/shared';

export class WorkflowNodeDto extends createZodDto(WorkflowNodeSchema) {}

export class WorkflowGraphDto extends createZodDto(WorkflowGraphSchema) {}
export type WorkflowGraph = WorkflowGraphDto;
export class CreateWorkflowRequestDto extends WorkflowGraphDto {}
export const UpdateWorkflowRequestSchema = WorkflowGraphSchema.safeExtend({
  expectedVersionId: z.string().uuid().optional(),
});
export class UpdateWorkflowRequestDto extends createZodDto(UpdateWorkflowRequestSchema) {}

export const UpdateWorkflowMetadataSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
});

export class UpdateWorkflowMetadataDto extends createZodDto(UpdateWorkflowMetadataSchema) {}

const BaseRunWorkflowRequestSchema = z.object({
  inputs: z.record(z.string(), z.unknown()).optional(),
  versionId: z.string().uuid().optional(),
  version: z.coerce.number().int().min(1).optional(),
  scopeId: z.string().uuid().optional(),
});

const validateVersionSelection = (value: { versionId?: string; version?: number }) =>
  !(value.version && value.versionId);

export const RunWorkflowRequestSchema = BaseRunWorkflowRequestSchema.refine(
  validateVersionSelection,
  'Provide either version or versionId, not both',
);

export class RunWorkflowRequestDto extends createZodDto(RunWorkflowRequestSchema) {}
export const NodeOverridesSchema = z
  .record(
    z.string(),
    z.object({
      params: z.record(z.string(), z.unknown()).default({}),
      inputOverrides: z.record(z.string(), z.unknown()).default({}),
    }),
  )
  .optional();

export const PrepareRunRequestSchema = BaseRunWorkflowRequestSchema.extend({
  workflowId: z.string().uuid(),
  nodeOverrides: NodeOverridesSchema,
  trigger: ExecutionTriggerMetadataSchema.optional(),
  runId: z.string().optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
  parentRunId: z.string().optional(),
  parentNodeRef: z.string().optional(),
}).refine(validateVersionSelection, 'Provide either version or versionId, not both');

export class PrepareRunRequestDto extends createZodDto(PrepareRunRequestSchema) {}

export const ListRunsQuerySchema = z.object({
  workflowId: z.string().trim().min(1).optional(),
  status: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(ExecutionStatusSchema)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0).optional(),
  scopeId: z.string().uuid().optional(),
});

export class ListRunsQueryDto extends createZodDto(ListRunsQuerySchema) {}

export const TemporalRunQuerySchema = z.object({
  temporalRunId: z.string().trim().min(1).optional(),
});

export class TemporalRunQueryDto extends createZodDto(TemporalRunQuerySchema) {}

export const StreamRunQuerySchema = TemporalRunQuerySchema.extend({
  cursor: z.string().trim().min(1).optional(),
  terminalCursor: z.string().trim().optional(),
  logCursor: z.string().datetime().optional(),
});

export class StreamRunQueryDto extends createZodDto(StreamRunQuerySchema) {}

export const WorkflowLogsQuerySchema = z.object({
  nodeRef: z.string().trim().min(1).optional(),
  stream: z.enum(['stdout', 'stderr', 'console']).optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().datetime().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

export class WorkflowLogsQueryDto extends createZodDto(WorkflowLogsQuerySchema) {}

export const TerminalChunksQuerySchema = z.object({
  nodeRef: z.string().trim().min(1).optional(),
  stream: z.enum(['stdout', 'stderr', 'pty']).optional(),
  cursor: z.string().trim().optional(),
  startTime: z.string().datetime().optional(), // ISO 8601 datetime string
  endTime: z.string().datetime().optional(), // ISO 8601 datetime string
});

export class TerminalChunksQueryDto extends createZodDto(TerminalChunksQuerySchema) {}

// API Response DTOs for flattened workflow structures
// These represent the actual API response format after the service flattens the graph fields

// Type for service layer (with Date objects from DB)
export interface ServiceWorkflowResponse {
  id: string;
  name: string;
  description?: string | null;
  graph: z.infer<typeof WorkflowGraphSchema>; // The original stored graph (contains nodes, edges, viewport)
  compiledDefinition: Record<string, unknown> | null;
  lastRun: Date | null;
  runCount: number;
  createdAt: Date;
  updatedAt: Date;
  currentVersionId: string | null;
  currentVersion: number | null;
}

// Zod schema for API response validation (with string dates for JSON serialization)
export const WorkflowResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().nullable(),
  graph: WorkflowGraphSchema, // The original stored graph (contains nodes, edges, viewport)
  compiledDefinition: z.unknown().nullable(),
  lastRun: z.string().nullable(), // Date string from JSON serialization
  runCount: z.number().int().nonnegative(),
  createdAt: z.string(), // Date string from JSON serialization
  updatedAt: z.string(), // Date string from JSON serialization
  currentVersionId: z.string().uuid().nullable(),
  currentVersion: z.number().int().positive().nullable(),
});

export class WorkflowResponseDto extends createZodDto(WorkflowResponseSchema) {}

export const WorkflowVersionResponseSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  version: z.number().int().positive(),
  graph: WorkflowGraphSchema,
  createdAt: z.string(),
});

export class WorkflowVersionResponseDto extends createZodDto(WorkflowVersionResponseSchema) {}

export const WorkflowVersionSummarySchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
});

export class WorkflowVersionSummaryDto extends createZodDto(WorkflowVersionSummarySchema) {}

// Runtime input definition for Entry Point
export const RuntimeInputSchema = WorkflowRuntimeInputDefinitionObjectSchema;

export type RuntimeInput = z.infer<typeof RuntimeInputSchema>;

export const WorkflowRuntimeInputsResponseSchema = z.object({
  workflowId: z.string(),
  inputs: z.array(RuntimeInputSchema),
});

export class WorkflowRuntimeInputsResponseDto extends createZodDto(
  WorkflowRuntimeInputsResponseSchema,
) {}

// Constants for entry point component identification
export const ENTRY_POINT_COMPONENT_IDS = ['core.workflow.entrypoint', 'entry-point'] as const;
