import { z } from 'zod';

import { ExecutionStatusSchema } from './execution.js';
import { LLM_PROVIDER_IDS } from './ai-model-catalog.js';
import { FindingTriageStatusSchema, UpdateFindingTriageSchema } from './finding-triage.js';
import { FindingObservationSeveritySchema } from './findings/findingObservation.js';
import type { McpOperationInvocationRequest } from './mcp-invocation.js';

export const OPERATOR_APPROVAL_MODES = ['ask', 'auto'] as const;
export const OperatorApprovalModeSchema = z.enum(OPERATOR_APPROVAL_MODES);
export type OperatorApprovalMode = z.infer<typeof OperatorApprovalModeSchema>;

export const OPERATOR_COMMAND_EFFECTS = ['read', 'execute', 'consequential'] as const;
export const OperatorCommandEffectSchema = z.enum(OPERATOR_COMMAND_EFFECTS);
export type OperatorCommandEffect = z.infer<typeof OperatorCommandEffectSchema>;

export const OPERATOR_SESSION_STATUSES = ['active', 'archived'] as const;
export const OperatorSessionStatusSchema = z.enum(OPERATOR_SESSION_STATUSES);
export type OperatorSessionStatus = z.infer<typeof OperatorSessionStatusSchema>;

export const OPERATOR_TURN_STATUSES = [
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const;
export const OperatorTurnStatusSchema = z.enum(OPERATOR_TURN_STATUSES);
export type OperatorTurnStatus = z.infer<typeof OperatorTurnStatusSchema>;

export const OPERATOR_MESSAGE_ROLES = ['user', 'assistant'] as const;
export const OperatorMessageRoleSchema = z.enum(OPERATOR_MESSAGE_ROLES);
export type OperatorMessageRole = z.infer<typeof OperatorMessageRoleSchema>;

export const OPERATOR_ACTION_STATUSES = [
  'proposed',
  'pending_approval',
  'approved',
  'rejected',
  'executing',
  'succeeded',
  'failed',
] as const;
export const OperatorActionStatusSchema = z.enum(OPERATOR_ACTION_STATUSES);
export type OperatorActionStatus = z.infer<typeof OperatorActionStatusSchema>;

export const OperatorModelConfigSchema = z
  .object({
    provider: z.enum(LLM_PROVIDER_IDS),
    modelId: z.string().trim().min(1).max(191),
    apiKeySecretId: z.string().uuid(),
    baseUrl: z.string().trim().url().max(2_048).optional().nullable(),
  })
  .strict();
export type OperatorModelConfig = z.infer<typeof OperatorModelConfigSchema>;

export const OperatorRouteContextSchema = z
  .object({
    path: z.string().trim().min(1).max(2_048),
    workflowId: z.string().uuid().optional(),
    runId: z.string().trim().min(1).max(191).optional(),
  })
  .strict();
export type OperatorRouteContext = z.infer<typeof OperatorRouteContextSchema>;

const WorkflowIdSchema = z.string().uuid();
const RunIdSchema = z.string().trim().min(1).max(191);
const FindingIdSchema = z.string().trim().min(1).max(512);

export const OperatorListWorkflowsInputSchema = z
  .object({
    search: z.string().trim().min(1).max(191).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export const OperatorGetWorkflowInputSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    versionId: z.string().uuid().optional(),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const OperatorListRunsInputSchema = z
  .object({
    workflowId: WorkflowIdSchema.optional(),
    status: ExecutionStatusSchema.optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export const OperatorGetRunInputSchema = z.object({ runId: RunIdSchema }).strict();

export const OperatorRunWorkflowInputSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    versionId: z.string().uuid(),
    inputs: z.record(z.string(), z.unknown()).default({}),
    scopeId: z.string().uuid().optional(),
  })
  .strict();

export const OperatorCancelRunInputSchema = z.object({ runId: RunIdSchema }).strict();

export const OperatorRetryRunInputSchema = z.object({ runId: RunIdSchema }).strict();

export const OperatorListFindingsInputSchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    severity: FindingObservationSeveritySchema.optional(),
    workflowId: z.string().trim().min(1).max(200).optional(),
    runId: z.string().trim().min(1).max(200).optional(),
    triageStatus: FindingTriageStatusSchema.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export const OperatorGetFindingInputSchema = z.object({ findingId: FindingIdSchema }).strict();

export const OperatorUpdateFindingTriageInputSchema = z
  .object({
    findingId: FindingIdSchema,
    ...UpdateFindingTriageSchema.shape,
  })
  .strict()
  .refine(
    (data) =>
      data.status !== undefined ||
      data.assigneeUserId !== undefined ||
      data.severityOverride !== undefined ||
      data.notes !== undefined,
    {
      message:
        'At least one of status, assigneeUserId, severityOverride, or notes must be provided',
    },
  );

const McpCapabilitySnapshotIdSchema = z.string().uuid();
const McpSourceIdSchema = z.string().trim().min(1).max(512);

export const OperatorListMcpServersInputSchema = z
  .object({
    search: z.string().trim().min(1).max(191).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export const OperatorListMcpCapabilitiesInputSchema = z
  .object({ serverId: z.string().uuid() })
  .strict();

export const OperatorInvokeMcpToolInputSchema = z
  .object({
    capabilitySnapshotId: McpCapabilitySnapshotIdSchema,
    sourceId: McpSourceIdSchema,
    name: z.string().trim().min(1).max(128),
    arguments: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const OperatorReadMcpResourceInputSchema = z
  .object({
    capabilitySnapshotId: McpCapabilitySnapshotIdSchema,
    sourceId: McpSourceIdSchema,
    uri: z.string().trim().min(1).max(8_192),
    templateUri: z.string().trim().min(1).max(8_192).optional(),
  })
  .strict();

export const OperatorGetMcpPromptInputSchema = z
  .object({
    capabilitySnapshotId: McpCapabilitySnapshotIdSchema,
    sourceId: McpSourceIdSchema,
    name: z.string().trim().min(1).max(8_192),
    arguments: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const OPERATOR_COMMAND_DEFINITIONS = {
  list_workflows: {
    description:
      "List the user's existing Sentris workflows. Use this to resolve a workflow name before inspecting or running it.",
    effect: 'read',
    inputSchema: OperatorListWorkflowsInputSchema,
  },
  get_workflow: {
    description:
      'Inspect one existing workflow version, including its graph summary and exact runtime-input contract. Use this before run_workflow so input IDs and types are not guessed.',
    effect: 'read',
    inputSchema: OperatorGetWorkflowInputSchema,
  },
  list_runs: {
    description:
      'List recent workflow runs, optionally restricted to a workflow or execution status.',
    effect: 'read',
    inputSchema: OperatorListRunsInputSchema,
  },
  get_run: {
    description:
      'Inspect one workflow run. Terminal runs include their bounded result; active runs include current status.',
    effect: 'read',
    inputSchema: OperatorGetRunInputSchema,
  },
  run_workflow: {
    description:
      'Run an existing workflow version with runtime inputs keyed by the exact IDs returned from get_workflow. Pass its returned immutable versionId, and use only when the user explicitly asks to run it.',
    effect: 'execute',
    inputSchema: OperatorRunWorkflowInputSchema,
  },
  cancel_run: {
    description:
      'Cancel an active workflow run. This is consequential and may require user approval.',
    effect: 'consequential',
    inputSchema: OperatorCancelRunInputSchema,
  },
  retry_run: {
    description:
      'Retry a workflow run as a new run using the original workflow version and stored inputs. Use only when the user explicitly asks to retry it.',
    effect: 'execute',
    inputSchema: OperatorRetryRunInputSchema,
  },
  list_findings: {
    description:
      'List security findings with authoritative triage state and data-health metadata. Use this to resolve a finding before inspecting or updating it.',
    effect: 'read',
    inputSchema: OperatorListFindingsInputSchema,
  },
  get_finding: {
    description:
      'Inspect one security finding, including bounded raw evidence and authoritative triage state.',
    effect: 'read',
    inputSchema: OperatorGetFindingInputSchema,
  },
  update_finding_triage: {
    description:
      'Update the status, assignee, severity override, or notes for one finding. Use only when the user explicitly asks for that triage change.',
    effect: 'execute',
    inputSchema: OperatorUpdateFindingTriageInputSchema,
  },
  list_mcp_servers: {
    description:
      "List the user's saved MCP servers and readiness. Use this before selecting a server capability.",
    effect: 'read',
    inputSchema: OperatorListMcpServersInputSchema,
  },
  list_mcp_capabilities: {
    description:
      'Discover one saved MCP server and materialize an immutable capability snapshot for this Operator turn.',
    effect: 'read',
    inputSchema: OperatorListMcpCapabilitiesInputSchema,
  },
  invoke_mcp_tool: {
    description:
      'Invoke one tool from an immutable MCP capability snapshot. MCP annotations are hints, so this is consequential in Ask mode.',
    effect: 'consequential',
    inputSchema: OperatorInvokeMcpToolInputSchema,
  },
  read_mcp_resource: {
    description:
      'Read an exact resource or an expanded resource template from an immutable MCP capability snapshot.',
    effect: 'read',
    inputSchema: OperatorReadMcpResourceInputSchema,
  },
  get_mcp_prompt: {
    description:
      'Get a prompt from an immutable MCP capability snapshot using optional string arguments.',
    effect: 'read',
    inputSchema: OperatorGetMcpPromptInputSchema,
  },
} as const satisfies Record<
  string,
  {
    description: string;
    effect: OperatorCommandEffect;
    inputSchema: z.ZodType;
  }
>;

export const OPERATOR_COMMAND_NAMES = Object.keys(
  OPERATOR_COMMAND_DEFINITIONS,
) as (keyof typeof OPERATOR_COMMAND_DEFINITIONS)[];
export const OperatorCommandNameSchema = z.enum(OPERATOR_COMMAND_NAMES);
export type OperatorCommandName = z.infer<typeof OperatorCommandNameSchema>;

export type OperatorCommandInputMap = {
  list_workflows: z.infer<typeof OperatorListWorkflowsInputSchema>;
  get_workflow: z.infer<typeof OperatorGetWorkflowInputSchema>;
  list_runs: z.infer<typeof OperatorListRunsInputSchema>;
  get_run: z.infer<typeof OperatorGetRunInputSchema>;
  run_workflow: z.infer<typeof OperatorRunWorkflowInputSchema>;
  cancel_run: z.infer<typeof OperatorCancelRunInputSchema>;
  retry_run: z.infer<typeof OperatorRetryRunInputSchema>;
  list_findings: z.infer<typeof OperatorListFindingsInputSchema>;
  get_finding: z.infer<typeof OperatorGetFindingInputSchema>;
  update_finding_triage: z.infer<typeof OperatorUpdateFindingTriageInputSchema>;
  list_mcp_servers: z.infer<typeof OperatorListMcpServersInputSchema>;
  list_mcp_capabilities: z.infer<typeof OperatorListMcpCapabilitiesInputSchema>;
  invoke_mcp_tool: z.infer<typeof OperatorInvokeMcpToolInputSchema>;
  read_mcp_resource: z.infer<typeof OperatorReadMcpResourceInputSchema>;
  get_mcp_prompt: z.infer<typeof OperatorGetMcpPromptInputSchema>;
};

export const OperatorDirectCommandSchema = z.discriminatedUnion('commandName', [
  z
    .object({
      commandName: z.literal('get_run'),
      arguments: OperatorGetRunInputSchema,
    })
    .strict(),
  z
    .object({
      commandName: z.literal('cancel_run'),
      arguments: OperatorCancelRunInputSchema,
    })
    .strict(),
  z
    .object({
      commandName: z.literal('retry_run'),
      arguments: OperatorRetryRunInputSchema,
    })
    .strict(),
]);
export type OperatorDirectCommand = z.infer<typeof OperatorDirectCommandSchema>;

export const OPERATOR_PERSISTED_TURN_PAYLOAD_VERSION = 1 as const;
export const OperatorPersistedTurnPayloadSchema = z
  .object({
    version: z.literal(OPERATOR_PERSISTED_TURN_PAYLOAD_VERSION),
    routeContext: OperatorRouteContextSchema.nullable(),
    directCommand: OperatorDirectCommandSchema.nullable(),
  })
  .strict();
export type OperatorPersistedTurnPayload = z.infer<typeof OperatorPersistedTurnPayloadSchema>;

/**
 * JSONB compatibility shape for Operator turns. Route-only objects and null predate
 * structured direct commands; all newly persisted rows use the versioned payload.
 */
export const OperatorStoredTurnContextSchema = z
  .union([OperatorPersistedTurnPayloadSchema, OperatorRouteContextSchema])
  .nullable();
export type OperatorStoredTurnContext = z.infer<typeof OperatorStoredTurnContextSchema>;

export const OperatorCreateSessionSchema = z
  .object({
    approvalMode: OperatorApprovalModeSchema.default('ask'),
    model: OperatorModelConfigSchema,
  })
  .strict();
export type OperatorCreateSession = z.infer<typeof OperatorCreateSessionSchema>;

export const OperatorUpdateSessionSchema = z
  .object({
    approvalMode: OperatorApprovalModeSchema.optional(),
    model: OperatorModelConfigSchema.optional(),
    title: z.string().trim().min(1).max(191).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export type OperatorUpdateSession = z.infer<typeof OperatorUpdateSessionSchema>;

export const OperatorCreateTurnSchema = z
  .object({
    clientTurnId: z.string().uuid(),
    message: z.string().trim().min(1).max(20_000),
    context: OperatorRouteContextSchema.optional(),
    directCommand: OperatorDirectCommandSchema.optional(),
  })
  .strict();
export type OperatorCreateTurn = z.infer<typeof OperatorCreateTurnSchema>;

export const OperatorActionDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type OperatorActionDecision = z.infer<typeof OperatorActionDecisionSchema>;

export interface OperatorSessionSummary {
  id: string;
  title: string;
  approvalMode: OperatorApprovalMode;
  status: OperatorSessionStatus;
  model: OperatorModelConfig;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorTurnView {
  id: string;
  sessionId: string;
  status: OperatorTurnStatus;
  temporalWorkflowId: string | null;
  temporalRunId: string | null;
  context: OperatorRouteContext | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface OperatorMessageView {
  id: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  role: OperatorMessageRole;
  content: string;
  createdAt: string;
}

export interface OperatorActionView {
  id: string;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  commandName: OperatorCommandName;
  effect: OperatorCommandEffect;
  approvalMode: OperatorApprovalMode;
  approvalRequired: boolean;
  status: OperatorActionStatus;
  version: number;
  arguments: Record<string, unknown>;
  result: unknown;
  error: string | null;
  runId: string | null;
  createdAt: string;
  decidedAt: string | null;
  completedAt: string | null;
}

export interface OperatorSessionDetail extends OperatorSessionSummary {
  turns: OperatorTurnView[];
  messages: OperatorMessageView[];
  actions: OperatorActionView[];
}

export interface OperatorTurnAccepted {
  turnId: string;
  status: OperatorTurnStatus;
}

export interface OperatorModelContext {
  session: OperatorSessionSummary & {
    organizationId: string;
    userId: string;
  };
  turn: OperatorTurnView;
  messages: OperatorMessageView[];
  actions: OperatorActionView[];
}

export interface OperatorPreparedAction {
  action: OperatorActionView;
  disposition: 'execute' | 'wait_for_approval' | 'rejected' | 'already_completed';
}

export interface OperatorCommandExecutionResult {
  action: OperatorActionView;
  result: unknown;
  launchedRunId?: string;
  mcpOperationRequest?: McpOperationInvocationRequest;
}

export interface OperatorRunObservation {
  runId: string;
  workflowId: string;
  status: string;
  terminal: boolean;
  result?: unknown;
}
