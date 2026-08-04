import { z } from 'zod';
import {
  MCP_CAPABILITY_CONTRACT_VERSION,
  MCP_LEGACY_CAPABILITY_CONTRACT_VERSION,
  type CapabilityGrant,
  type ExecutionScope,
  ExecutionScopeSchema,
  type McpCapabilityCatalogSnapshot,
  McpReadyRuntimeRefSchema,
  McpRuntimeFenceSchema,
  McpSnapshotRuntimeBindingSchema,
  type ToolDescriptor,
} from './mcp-capabilities.js';

export const TOOL_INVOCATION_UPDATE_NAME = 'executeToolInvocation' as const;
export const MCP_OPERATION_UPDATE_NAME = 'executeMcpOperation' as const;
export const INSTALL_TOOL_INVOCATION_MANIFEST_UPDATE_NAME =
  'installToolInvocationManifest' as const;
export const TOOL_INVOCATION_PROTOCOL_QUERY_NAME = 'getToolInvocationProtocolVersion' as const;
export const TOOL_INVOCATION_PROTOCOL_VERSION = 1 as const;
export const MCP_OPERATION_PROTOCOL_QUERY_NAME = 'getMcpOperationProtocolVersion' as const;
export const MCP_OPERATION_PROTOCOL_VERSION = 1 as const;
export const MAX_INLINE_INVOCATION_INPUT_BYTES = 256 * 1024;
export const MAX_INLINE_INVOCATION_OUTPUT_BYTES = 1024 * 1024;
export const MAX_INVOCATION_MANIFEST_ENTRIES = 1024;
export const MAX_MCP_OPERATION_TARGET_CHARS = 8_192;
export const MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS = 8192;

export const InvocationAttemptStatusSchema = z.enum([
  'planned',
  'prepared',
  'dispatched',
  'completed',
  'failed',
  'ambiguous',
  'cancelled',
]);

export const ToolInvocationFailureClassSchema = z.enum([
  'validation',
  'authorization',
  'deadline-before-dispatch',
  'pre-dispatch',
  'remote-tool',
  'cancelled',
  'ambiguous-after-dispatch',
  'runtime-owner-loss',
]);

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

type JsonTraversalFrame = { kind: 'enter'; value: unknown } | { kind: 'exit'; value: object };

function isPlainJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isFiniteJsonValue(root: unknown): root is JsonValue {
  const ancestors = new WeakSet<object>();
  const stack: JsonTraversalFrame[] = [{ kind: 'enter', value: root }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;

    if (frame.kind === 'exit') {
      ancestors.delete(frame.value);
      continue;
    }

    const value = frame.value;
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      continue;
    }

    if (typeof value !== 'object') {
      return false;
    }

    if (ancestors.has(value)) {
      return false;
    }

    let children: unknown[];
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);

      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype || keys.length - 1 !== value.length) {
          return false;
        }

        children = [];
        for (const key of keys) {
          if (key === 'length') continue;
          if (typeof key !== 'string') return false;

          const index = Number(key);
          const descriptor = descriptors[key];
          if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= value.length ||
            String(index) !== key ||
            !descriptor?.enumerable ||
            !('value' in descriptor)
          ) {
            return false;
          }
          children.push(descriptor.value);
        }
      } else {
        if (!isPlainJsonObject(value)) return false;

        children = [];
        for (const key of keys) {
          if (typeof key !== 'string') return false;

          const descriptor = descriptors[key];
          if (!descriptor?.enumerable || !('value' in descriptor)) {
            return false;
          }
          children.push(descriptor.value);
        }
      }
    } catch {
      return false;
    }

    ancestors.add(value);
    stack.push({ kind: 'exit', value });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ kind: 'enter', value: children[index] });
    }
  }

  return true;
}

export const JsonValueSchema: z.ZodType<JsonValue> = z.custom<JsonValue>(isFiniteJsonValue, {
  message: 'Expected finite JSON value',
});

export const JsonObjectSchema: z.ZodType<JsonObject> = z.custom<JsonObject>(
  (value) => isPlainJsonObject(value) && isFiniteJsonValue(value),
  { message: 'Expected finite JSON object' },
);

function isWithinInlineJsonByteLimit(value: JsonValue, maximumBytes: number): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maximumBytes;
  } catch {
    return false;
  }
}

const BoundedMcpOperationArgumentsSchema = JsonObjectSchema.refine(
  (input) => isWithinInlineJsonByteLimit(input, MAX_INLINE_INVOCATION_INPUT_BYTES),
  { message: 'MCP operation input exceeds 262144 UTF-8 bytes' },
);

export const PromptArgumentsSchema = z
  .record(z.string(), z.string())
  .refine((input) => isWithinInlineJsonByteLimit(input, MAX_INLINE_INVOCATION_INPUT_BYTES), {
    message: 'MCP operation input exceeds 262144 UTF-8 bytes',
  });

export const McpToolCallOperationSchema = z
  .object({
    kind: z.literal('tool-call'),
    name: z.string().min(1),
    arguments: BoundedMcpOperationArgumentsSchema,
  })
  .strict();

export const McpResourceReadOperationSchema = z
  .object({
    kind: z.literal('resource-read'),
    uri: z.string().min(1),
  })
  .strict();
export type McpResourceReadOperation = z.infer<typeof McpResourceReadOperationSchema>;

export const McpPromptGetOperationSchema = z
  .object({
    kind: z.literal('prompt-get'),
    name: z.string().min(1),
    arguments: PromptArgumentsSchema,
  })
  .strict();
export type McpPromptGetOperation = z.infer<typeof McpPromptGetOperationSchema>;

export const McpOperationSchema = z.discriminatedUnion('kind', [
  McpToolCallOperationSchema,
  McpResourceReadOperationSchema,
  McpPromptGetOperationSchema,
]);
export type McpOperation = z.infer<typeof McpOperationSchema>;

export const McpSavedServerPreviewRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resource'), uri: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('resource-template'),
      uriTemplate: z.string().min(1),
      arguments: PromptArgumentsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('prompt'),
      name: z.string().min(1),
      arguments: PromptArgumentsSchema,
    })
    .strict(),
]);
export type McpSavedServerPreviewRequest = z.infer<typeof McpSavedServerPreviewRequestSchema>;

export const McpSavedServerPreviewResponseSchema = z
  .object({
    kind: z.enum(['resource', 'prompt']),
    target: z.string().min(1),
    output: JsonValueSchema.refine(
      (output) => isWithinInlineJsonByteLimit(output, MAX_INLINE_INVOCATION_OUTPUT_BYTES),
      { message: 'MCP preview output exceeds 1048576 UTF-8 bytes' },
    ),
  })
  .strict();
export type McpSavedServerPreviewResponse = z.infer<typeof McpSavedServerPreviewResponseSchema>;

export const McpOperationInvocationRequestSchema = z
  .object({
    invocationId: z.string().uuid(),
    scope: ExecutionScopeSchema,
    capabilitySnapshotId: z.string().uuid(),
    sourceId: z.string().min(1),
    authorizationTarget: z.string().min(1).max(MAX_MCP_OPERATION_TARGET_CHARS),
    operation: McpOperationSchema,
    requestedAt: z.string().datetime(),
    deadlineAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (request) =>
      isWithinInlineJsonByteLimit(
        request as unknown as JsonObject,
        MAX_INLINE_INVOCATION_INPUT_BYTES,
      ),
    { message: 'MCP operation invocation exceeds 262144 UTF-8 bytes' },
  )
  .superRefine(({ requestedAt, deadlineAt }, context) => {
    if (new Date(deadlineAt) < new Date(requestedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['deadlineAt'],
        message: 'MCP operation invocation deadline must not be before requestedAt',
      });
    }
  });
export type McpOperationInvocationRequest = z.infer<typeof McpOperationInvocationRequestSchema>;

export const McpRuntimeOperationRequestSchema = z
  .object({
    operationId: z.string().uuid(),
    fence: McpRuntimeFenceSchema,
    operation: McpOperationSchema,
    requestedAt: z.string().datetime(),
    deadlineAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (request) =>
      isWithinInlineJsonByteLimit(request as JsonObject, MAX_INLINE_INVOCATION_INPUT_BYTES),
    { message: 'MCP operation request exceeds 262144 UTF-8 bytes' },
  )
  .superRefine(({ requestedAt, deadlineAt }, context) => {
    if (new Date(deadlineAt) < new Date(requestedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['deadlineAt'],
        message: 'MCP operation deadline must not be before requestedAt',
      });
    }
  });
export type McpRuntimeOperationRequest = z.infer<typeof McpRuntimeOperationRequestSchema>;

const McpOperationTerminalShape = {
  operationId: z.string().uuid(),
  completedAt: z.string().datetime(),
};

export const McpOperationResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...McpOperationTerminalShape,
      kind: z.literal('completed'),
      output: JsonValueSchema.refine(
        (output) => isWithinInlineJsonByteLimit(output, MAX_INLINE_INVOCATION_OUTPUT_BYTES),
        { message: 'MCP operation output exceeds 1048576 UTF-8 bytes' },
      ),
    })
    .strict(),
  z
    .object({
      ...McpOperationTerminalShape,
      kind: z.literal('remote-failure'),
      message: z.string().min(1).max(MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS),
      retryable: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...McpOperationTerminalShape,
      kind: z.literal('cancelled'),
      message: z.string().min(1).max(MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS),
    })
    .strict(),
  z
    .object({
      ...McpOperationTerminalShape,
      kind: z.literal('ambiguous'),
      message: z.string().min(1).max(MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS),
    })
    .strict(),
  z
    .object({
      ...McpOperationTerminalShape,
      kind: z.literal('input-required-unsupported'),
      message: z.string().min(1).max(MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS),
      retryable: z.literal(false),
    })
    .strict(),
]);
export type McpOperationResult = z.infer<typeof McpOperationResultSchema>;

export const LegacyInvocationManifestEntrySchema = z
  .object({
    toolName: z.string().min(1),
    sourceId: z.string().min(1),
    destination: z.enum(['component-activity', 'mcp-activity']),
    retryPolicy: z.enum(['pre-dispatch-only', 'reviewed-idempotent']),
  })
  .strict()
  .readonly();
export type LegacyInvocationManifestEntry = z.infer<typeof LegacyInvocationManifestEntrySchema>;

export const McpOperationManifestEntrySchema = z
  .object({
    operationKind: z.enum(['tool-call', 'resource-read', 'prompt-get']),
    operationTarget: z.string().min(1).max(MAX_MCP_OPERATION_TARGET_CHARS),
    sourceId: z.string().min(1),
    destination: z.enum(['component-activity', 'mcp-activity']),
    retryPolicy: z.enum(['pre-dispatch-only', 'reviewed-idempotent']),
  })
  .strict()
  .readonly();
export type McpOperationManifestEntry = z.infer<typeof McpOperationManifestEntrySchema>;

export const InvocationManifestEntrySchema = z.union([
  LegacyInvocationManifestEntrySchema,
  McpOperationManifestEntrySchema,
]);
export type InvocationManifestEntry = z.infer<typeof InvocationManifestEntrySchema>;

const InvocationManifestBaseShape = {
  capabilitySnapshotId: z.string().uuid(),
  capabilityGrantId: z.string().uuid(),
} as const;

export const LegacyInvocationManifestSchema = z
  .object({
    ...InvocationManifestBaseShape,
    version: z.literal(MCP_LEGACY_CAPABILITY_CONTRACT_VERSION),
    entries: z
      .array(LegacyInvocationManifestEntrySchema)
      .max(MAX_INVOCATION_MANIFEST_ENTRIES)
      .readonly(),
  })
  .strict()
  .readonly();
export const DurableMcpOperationInvocationManifestSchema = z
  .object({
    ...InvocationManifestBaseShape,
    version: z.literal(MCP_CAPABILITY_CONTRACT_VERSION),
    entries: z
      .array(McpOperationManifestEntrySchema)
      .max(MAX_INVOCATION_MANIFEST_ENTRIES)
      .readonly(),
  })
  .strict()
  .readonly();
export const InvocationManifestSchema = z.discriminatedUnion('version', [
  LegacyInvocationManifestSchema,
  DurableMcpOperationInvocationManifestSchema,
]);
export type InvocationManifest = z.infer<typeof InvocationManifestSchema>;

export const InstallToolInvocationManifestRequestSchema = z
  .object({
    scope: ExecutionScopeSchema,
    manifest: InvocationManifestSchema,
  })
  .strict()
  .superRefine(({ scope, manifest }, context) => {
    if (scope.capabilityGrantId !== manifest.capabilityGrantId) {
      context.addIssue({
        code: 'custom',
        path: ['manifest', 'capabilityGrantId'],
        message: 'Invocation manifest does not match the execution scope grant',
      });
    }
  });
export type InstallToolInvocationManifestRequest = z.infer<
  typeof InstallToolInvocationManifestRequestSchema
>;

export const ToolInvocationRequestSchema = z
  .object({
    invocationId: z.string().uuid(),
    scope: ExecutionScopeSchema,
    capabilitySnapshotId: z.string().uuid(),
    toolName: z.string().min(1).max(128),
    input: JsonObjectSchema.refine(
      (input) => isWithinInlineJsonByteLimit(input, MAX_INLINE_INVOCATION_INPUT_BYTES),
      { message: 'Invocation input exceeds 262144 UTF-8 bytes' },
    ),
    requestedAt: z.string().datetime(),
    deadlineAt: z.string().datetime(),
  })
  .strict()
  .superRefine(({ requestedAt, deadlineAt }, context) => {
    if (new Date(deadlineAt) < new Date(requestedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['deadlineAt'],
        message: 'Invocation deadline must not be before requestedAt',
      });
    }
  });
export type ToolInvocationRequest = z.infer<typeof ToolInvocationRequestSchema>;

export const PreparedInvocationRefSchema = z
  .object({
    invocationId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptNumber: z.number().int().positive(),
    capabilitySnapshotId: z.string().uuid(),
    capabilityGrantId: z.string().uuid(),
    toolName: z.string().min(1).max(128),
    sourceId: z.string().min(1),
    destination: z.enum(['component-activity', 'mcp-activity']),
    retryPolicy: z.enum(['pre-dispatch-only', 'reviewed-idempotent']),
    preparedAt: z.string().datetime(),
  })
  .strict();
export type PreparedInvocationRef = z.infer<typeof PreparedInvocationRefSchema>;

export const PreparedMcpOperationRefSchema = z
  .object({
    invocationId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptNumber: z.number().int().positive(),
    capabilitySnapshotId: z.string().uuid(),
    capabilityGrantId: z.string().uuid(),
    operationKind: z.enum(['tool-call', 'resource-read', 'prompt-get']),
    operationTarget: z.string().min(1).max(MAX_MCP_OPERATION_TARGET_CHARS),
    toolName: z.string().min(1).max(128).nullable(),
    sourceId: z.string().min(1),
    destination: z.enum(['component-activity', 'mcp-activity']),
    retryPolicy: z.enum(['pre-dispatch-only', 'reviewed-idempotent']),
    preparedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((ref, context) => {
    const expectedToolName = ref.operationKind === 'tool-call' ? ref.operationTarget : null;
    if (ref.toolName !== expectedToolName) {
      context.addIssue({
        code: 'custom',
        path: ['toolName'],
        message: 'Tool compatibility name must match the durable operation target',
      });
    }
    if (ref.destination === 'component-activity' && ref.operationKind !== 'tool-call') {
      context.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'Only tool calls may dispatch to component activities',
      });
    }
  });
export type PreparedMcpOperationRef = z.infer<typeof PreparedMcpOperationRefSchema>;

const McpOperationDispatchPlanBaseShape = {
  ref: PreparedMcpOperationRefSchema,
  manifestEntry: McpOperationManifestEntrySchema,
  operation: McpOperationSchema,
  requestedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
};

export const McpOperationDispatchPlanSchema = z
  .union([
    z
      .object({
        ...McpOperationDispatchPlanBaseShape,
        runtimeBinding: McpSnapshotRuntimeBindingSchema,
      })
      .strict(),
    z.object(McpOperationDispatchPlanBaseShape).strict(),
  ])
  .superRefine((plan, context) => {
    const { ref, manifestEntry, operation } = plan;
    if (
      manifestEntry.operationKind !== ref.operationKind ||
      manifestEntry.operationTarget !== ref.operationTarget ||
      manifestEntry.sourceId !== ref.sourceId ||
      manifestEntry.destination !== ref.destination ||
      manifestEntry.retryPolicy !== ref.retryPolicy ||
      operation.kind !== ref.operationKind
    ) {
      context.addIssue({
        code: 'custom',
        message: 'MCP operation dispatch plan does not match its immutable authority',
      });
    }
    if (ref.destination === 'mcp-activity' && !('runtimeBinding' in plan)) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeBinding'],
        message: 'Outbound MCP dispatch requires a snapshotted runtime binding',
      });
    }
    if (ref.destination === 'component-activity' && 'runtimeBinding' in plan) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeBinding'],
        message: 'Component dispatch must not claim an MCP runtime binding',
      });
    }
    if (new Date(plan.deadlineAt) < new Date(plan.requestedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['deadlineAt'],
        message: 'MCP operation dispatch deadline must not be before requestedAt',
      });
    }
  });
export type McpOperationDispatchPlan = z.infer<typeof McpOperationDispatchPlanSchema>;

export const PrepareMcpOperationOutcomeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('prepared'),
      plan: McpOperationDispatchPlanSchema,
      manifest: InvocationManifestSchema,
    })
    .strict(),
  z.object({ kind: z.literal('terminal'), result: McpOperationResultSchema }).strict(),
]);
export type PrepareMcpOperationOutcome = z.infer<typeof PrepareMcpOperationOutcomeSchema>;

export const ClaimMcpOperationDispatchRequestSchema = z
  .object({
    plan: McpOperationDispatchPlanSchema,
    runtimeRef: McpReadyRuntimeRefSchema.optional(),
  })
  .strict()
  .superRefine((claim, context) => {
    const { plan, runtimeRef } = claim;
    if (plan.ref.destination === 'component-activity') {
      if ('runtimeBinding' in plan || runtimeRef !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Component dispatch claims cannot include an MCP runtime',
        });
      }
      return;
    }
    if (!('runtimeBinding' in plan) || runtimeRef === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Outbound dispatch claims require an acquired MCP runtime',
      });
      return;
    }
    if (
      plan.runtimeBinding.protocolEra !== runtimeRef.protocolEra ||
      plan.runtimeBinding.protocolVersion !== runtimeRef.protocolVersion ||
      plan.runtimeBinding.capabilityFingerprint !== runtimeRef.capabilityFingerprint
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeRef'],
        message: 'Acquired MCP runtime does not match the immutable snapshot binding',
      });
    }
  });
export type ClaimMcpOperationDispatchRequest = z.infer<
  typeof ClaimMcpOperationDispatchRequestSchema
>;

export const McpOperationComponentDispatchContextSchema = z
  .object({
    ref: PreparedMcpOperationRefSchema,
    run: z
      .object({
        runId: z.string().min(1),
        workflowId: z.string().uuid(),
        workflowVersionId: z.string().uuid(),
        organizationId: z.string().min(1).nullable(),
        scopeId: z.string().uuid(),
      })
      .strict(),
    component: z
      .object({
        nodeId: z.string().min(1),
        componentId: z.string().min(1),
        arguments: JsonObjectSchema,
        parameters: JsonObjectSchema,
        credentials: JsonObjectSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type McpOperationComponentDispatchContext = z.infer<
  typeof McpOperationComponentDispatchContextSchema
>;

export const ClaimMcpOperationDispatchOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claimed') }).strict(),
  z
    .object({
      kind: z.literal('component-dispatch'),
      context: McpOperationComponentDispatchContextSchema,
    })
    .strict(),
  z.object({ kind: z.literal('terminal'), result: McpOperationResultSchema }).strict(),
]);
export type ClaimMcpOperationDispatchOutcome = z.infer<
  typeof ClaimMcpOperationDispatchOutcomeSchema
>;

export const SettleMcpOperationAttemptRequestSchema = z
  .object({
    ref: PreparedMcpOperationRefSchema,
    fence: McpRuntimeFenceSchema.nullable(),
    result: McpOperationResultSchema,
  })
  .strict();
export type SettleMcpOperationAttemptRequest = z.infer<
  typeof SettleMcpOperationAttemptRequestSchema
>;

export const ReconcileMcpOperationDispatchRequestSchema = z
  .object({
    ref: PreparedMcpOperationRefSchema,
    cause: z.enum(['failure', 'deadline', 'cancelled']),
    message: z.string().min(1).max(MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS),
    completedAt: z.string().datetime(),
  })
  .strict();
export type ReconcileMcpOperationDispatchRequest = z.infer<
  typeof ReconcileMcpOperationDispatchRequestSchema
>;

export const ToolInvocationErrorSchema = z
  .object({
    class: ToolInvocationFailureClassSchema,
    message: z.string().min(1).max(MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS),
    retryable: z.boolean(),
  })
  .strict();

export const ToolInvocationResultSchema = z
  .object({
    invocationId: z.string().uuid(),
    status: z.enum(['completed', 'failed', 'ambiguous', 'cancelled']),
    output: JsonValueSchema.optional(),
    error: ToolInvocationErrorSchema.optional(),
    completedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.output !== undefined &&
      !isWithinInlineJsonByteLimit(result.output, MAX_INLINE_INVOCATION_OUTPUT_BYTES)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['output'],
        message: 'Invocation output exceeds 1048576 UTF-8 bytes',
      });
    }

    if (result.status === 'completed') {
      if (result.output === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['output'],
          message: 'Completed invocations require output',
        });
      }
      if (result.error !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['error'],
          message: 'Completed invocations must not include an error',
        });
      }
      return;
    }

    if (result.error === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Terminal invocation failures require an error',
      });
    }
    if (result.output !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['output'],
        message: 'Terminal invocation failures must not include output',
      });
    }
  });
export type ToolInvocationResult = z.infer<typeof ToolInvocationResultSchema>;

export const PrepareToolInvocationOutcomeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('prepared'),
      ref: PreparedInvocationRefSchema,
      manifest: InvocationManifestSchema,
    })
    .strict(),
  z.object({ kind: z.literal('terminal'), result: ToolInvocationResultSchema }).strict(),
]);
export type PrepareToolInvocationOutcome = z.infer<typeof PrepareToolInvocationOutcomeSchema>;

export const ComponentInvocationDispatchContextSchema = z
  .object({
    ref: PreparedInvocationRefSchema,
    run: z
      .object({
        runId: z.string().min(1),
        workflowId: z.string().uuid(),
        workflowVersionId: z.string().uuid().nullable(),
        organizationId: z.string().min(1).nullable(),
        scopeId: z.string().uuid().nullable(),
      })
      .strict(),
    component: z
      .object({
        nodeId: z.string().min(1),
        componentId: z.string().min(1),
        arguments: JsonObjectSchema,
        parameters: JsonObjectSchema,
        credentials: JsonObjectSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type ComponentInvocationDispatchContext = z.infer<
  typeof ComponentInvocationDispatchContextSchema
>;

export const ClaimComponentDispatchOutcomeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('dispatch'),
      context: ComponentInvocationDispatchContextSchema,
    })
    .strict(),
  z.object({ kind: z.literal('terminal'), result: ToolInvocationResultSchema }).strict(),
]);
export type ClaimComponentDispatchOutcome = z.infer<typeof ClaimComponentDispatchOutcomeSchema>;

export function assertCapabilityGrantApplies(scope: ExecutionScope, grant: CapabilityGrant): void {
  if (scope.capabilityGrantId !== grant.id) {
    throw new Error('Capability grant does not match the execution scope');
  }

  if (scope.organizationId !== grant.organizationId) {
    throw new Error('Capability grant organization does not match the execution scope');
  }

  if (scope.kind !== grant.subject.kind) {
    throw new Error('Capability grant subject kind does not match the execution scope');
  }

  switch (scope.kind) {
    case 'run':
      if (grant.subject.kind !== 'run' || scope.runId !== grant.subject.runId) {
        throw new Error('Capability grant run does not match the execution scope');
      }
      return;
    case 'studio':
      if (
        grant.subject.kind !== 'studio' ||
        scope.operationId !== grant.subject.operationId ||
        scope.expiresAt !== grant.subject.expiresAt
      ) {
        throw new Error('Capability grant studio subject does not match the execution scope');
      }
      return;
    case 'discovery':
      if (
        grant.subject.kind !== 'discovery' ||
        scope.operationId !== grant.subject.operationId ||
        scope.expiresAt !== grant.subject.expiresAt
      ) {
        throw new Error('Capability grant discovery subject does not match the execution scope');
      }
      return;
    case 'operator':
      if (
        grant.subject.kind !== 'operator' ||
        scope.sessionId !== grant.subject.sessionId ||
        scope.turnId !== grant.subject.turnId ||
        scope.expiresAt !== grant.subject.expiresAt
      ) {
        throw new Error('Capability grant Operator subject does not match the execution scope');
      }
  }
}

function manifestRetryPolicy(tool: ToolDescriptor): McpOperationManifestEntry['retryPolicy'] {
  if (
    tool.retryPolicy === 'reviewed-idempotent' &&
    (tool.effectsSource === 'sentris-contract' || tool.effectsSource === 'operator-policy')
  ) {
    return 'reviewed-idempotent';
  }

  return 'pre-dispatch-only';
}

export function buildInvocationManifest(
  snapshot: McpCapabilityCatalogSnapshot,
  grant: CapabilityGrant,
): InvocationManifest {
  assertCapabilityGrantApplies(snapshot.scope, grant);

  const canonicalNames = new Set<string>();
  for (const tool of snapshot.tools) {
    if (canonicalNames.has(tool.canonicalName)) {
      throw new Error(`Duplicate canonical tool name: ${tool.canonicalName}`);
    }
    canonicalNames.add(tool.canonicalName);
  }

  const accessBySource = new Map(
    grant.sources.map((source) => [source.sourceId, source.toolAccess] as const),
  );

  const toolEntries = snapshot.tools
    .filter((tool) => {
      const access = accessBySource.get(tool.source.sourceId);
      return (
        access?.mode === 'all' ||
        (access?.mode === 'subset' && access.names.includes(tool.canonicalName))
      );
    })
    .map<McpOperationManifestEntry>((tool) => ({
      operationKind: 'tool-call',
      operationTarget: tool.canonicalName,
      sourceId: tool.source.sourceId,
      destination: tool.source.kind === 'component' ? 'component-activity' : 'mcp-activity',
      retryPolicy: manifestRetryPolicy(tool),
    }));
  const grantedSources = new Set(grant.sources.map((source) => source.sourceId));
  const resourceEntries: McpOperationManifestEntry[] = [
    ...snapshot.resources.map((resource) => ({
      operationKind: 'resource-read' as const,
      operationTarget: resource.uri,
      sourceId: resource.sourceId,
      destination: 'mcp-activity' as const,
      retryPolicy: 'reviewed-idempotent' as const,
    })),
    ...snapshot.resourceTemplates.map((template) => ({
      operationKind: 'resource-read' as const,
      operationTarget: template.uriTemplate,
      sourceId: template.sourceId,
      destination: 'mcp-activity' as const,
      retryPolicy: 'reviewed-idempotent' as const,
    })),
  ].filter((entry) => grantedSources.has(entry.sourceId));
  const promptEntries: McpOperationManifestEntry[] = snapshot.prompts
    .filter((prompt) => grantedSources.has(prompt.sourceId))
    .map((prompt) => ({
      operationKind: 'prompt-get',
      operationTarget: prompt.name,
      sourceId: prompt.sourceId,
      destination: 'mcp-activity',
      retryPolicy: 'reviewed-idempotent',
    }));
  const entries = [...toolEntries, ...resourceEntries, ...promptEntries].sort(
    (left, right) =>
      left.operationKind.localeCompare(right.operationKind) ||
      left.operationTarget.localeCompare(right.operationTarget) ||
      left.sourceId.localeCompare(right.sourceId),
  );
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = `${entry.operationKind}\0${entry.operationTarget}\0${entry.sourceId}`;
    if (identities.has(identity)) {
      throw new Error(
        `Duplicate MCP operation manifest entry: ${entry.operationKind} ${entry.operationTarget} ${entry.sourceId}`,
      );
    }
    identities.add(identity);
  }

  if (snapshot.version === MCP_LEGACY_CAPABILITY_CONTRACT_VERSION) {
    return LegacyInvocationManifestSchema.parse({
      capabilitySnapshotId: snapshot.id,
      capabilityGrantId: grant.id,
      version: MCP_LEGACY_CAPABILITY_CONTRACT_VERSION,
      entries: toolEntries.map((entry) => ({
        toolName: entry.operationTarget,
        sourceId: entry.sourceId,
        destination: entry.destination,
        retryPolicy: entry.retryPolicy,
      })),
    });
  }
  return DurableMcpOperationInvocationManifestSchema.parse({
    capabilitySnapshotId: snapshot.id,
    capabilityGrantId: grant.id,
    version: MCP_CAPABILITY_CONTRACT_VERSION,
    entries,
  });
}

export function resolveInvocationManifestEntry(
  manifest: InvocationManifest,
  input: {
    scope: ExecutionScope;
    capabilitySnapshotId: string;
    toolName: string;
  },
): LegacyInvocationManifestEntry {
  if (input.scope.capabilityGrantId !== manifest.capabilityGrantId) {
    throw new Error('Invocation manifest does not match the execution scope grant');
  }

  if (input.capabilitySnapshotId !== manifest.capabilitySnapshotId) {
    throw new Error('Invocation manifest does not match the capability snapshot');
  }

  const entry = manifest.entries.find(
    (candidate) =>
      ('toolName' in candidate && candidate.toolName === input.toolName) ||
      ('operationKind' in candidate &&
        candidate.operationKind === 'tool-call' &&
        candidate.operationTarget === input.toolName),
  );
  if (!entry) {
    throw new Error(`Tool is not authorized by the invocation manifest: ${input.toolName}`);
  }

  if ('toolName' in entry) return entry;
  return LegacyInvocationManifestEntrySchema.parse({
    toolName: entry.operationTarget,
    sourceId: entry.sourceId,
    destination: entry.destination,
    retryPolicy: entry.retryPolicy,
  });
}

export function resolveMcpOperationManifestEntry(
  manifest: InvocationManifest,
  input: McpOperationInvocationRequest,
): McpOperationManifestEntry {
  if (input.scope.capabilityGrantId !== manifest.capabilityGrantId) {
    throw new Error('Invocation manifest does not match the execution scope grant');
  }
  if (input.capabilitySnapshotId !== manifest.capabilitySnapshotId) {
    throw new Error('Invocation manifest does not match the capability snapshot');
  }
  const entry = manifest.entries.find((candidate) => {
    if ('toolName' in candidate) {
      return (
        input.operation.kind === 'tool-call' &&
        candidate.toolName === input.authorizationTarget &&
        candidate.sourceId === input.sourceId
      );
    }
    return (
      candidate.operationKind === input.operation.kind &&
      candidate.operationTarget === input.authorizationTarget &&
      candidate.sourceId === input.sourceId
    );
  });
  if (!entry) {
    throw new Error(
      `MCP operation is not authorized by the invocation manifest: ${input.operation.kind} ${input.authorizationTarget}`,
    );
  }
  if ('operationKind' in entry) return entry;
  return McpOperationManifestEntrySchema.parse({
    operationKind: 'tool-call',
    operationTarget: entry.toolName,
    sourceId: entry.sourceId,
    destination: entry.destination,
    retryPolicy: entry.retryPolicy,
  });
}
