import { z } from 'zod';
import {
  MCP_CAPABILITY_CONTRACT_VERSION,
  type CapabilityGrant,
  type ExecutionScope,
  ExecutionScopeSchema,
  type McpCapabilityCatalogSnapshot,
  type ToolDescriptor,
} from './mcp-capabilities.js';

export const TOOL_INVOCATION_UPDATE_NAME = 'executeToolInvocation' as const;
export const INSTALL_TOOL_INVOCATION_MANIFEST_UPDATE_NAME =
  'installToolInvocationManifest' as const;
export const TOOL_INVOCATION_PROTOCOL_QUERY_NAME = 'getToolInvocationProtocolVersion' as const;
export const TOOL_INVOCATION_PROTOCOL_VERSION = 1 as const;
export const MAX_INLINE_INVOCATION_INPUT_BYTES = 256 * 1024;
export const MAX_INLINE_INVOCATION_OUTPUT_BYTES = 1024 * 1024;
export const MAX_INVOCATION_MANIFEST_ENTRIES = 1024;
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

type JsonTraversalFrame =
  | { kind: 'enter'; value: unknown }
  | { kind: 'exit'; value: object };

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

export const InvocationManifestEntrySchema = z
  .object({
    toolName: z.string().min(1),
    sourceId: z.string().min(1),
    destination: z.enum(['component-activity', 'mcp-activity']),
    retryPolicy: z.enum(['pre-dispatch-only', 'reviewed-idempotent']),
  })
  .strict()
  .readonly();
export type InvocationManifestEntry = z.infer<typeof InvocationManifestEntrySchema>;

export const InvocationManifestSchema = z
  .object({
    capabilitySnapshotId: z.string().uuid(),
    capabilityGrantId: z.string().uuid(),
    version: z.literal(MCP_CAPABILITY_CONTRACT_VERSION),
    entries: z
      .array(InvocationManifestEntrySchema)
      .max(MAX_INVOCATION_MANIFEST_ENTRIES)
      .readonly(),
  })
  .strict()
  .readonly();
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
export type ClaimComponentDispatchOutcome = z.infer<
  typeof ClaimComponentDispatchOutcomeSchema
>;

export function assertCapabilityGrantApplies(
  scope: ExecutionScope,
  grant: CapabilityGrant,
): void {
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
  }
}

function manifestRetryPolicy(
  tool: ToolDescriptor,
): InvocationManifestEntry['retryPolicy'] {
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

  const entries = snapshot.tools
    .filter((tool) => {
      const access = accessBySource.get(tool.source.sourceId);
      return (
        access?.mode === 'all' ||
        (access?.mode === 'subset' && access.names.includes(tool.canonicalName))
      );
    })
    .map<InvocationManifestEntry>((tool) => ({
      toolName: tool.canonicalName,
      sourceId: tool.source.sourceId,
      destination: tool.source.kind === 'component' ? 'component-activity' : 'mcp-activity',
      retryPolicy: manifestRetryPolicy(tool),
    }))
    .sort((left, right) => {
      if (left.toolName < right.toolName) return -1;
      if (left.toolName > right.toolName) return 1;
      return 0;
    });

  return InvocationManifestSchema.parse({
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
): InvocationManifestEntry {
  if (input.scope.capabilityGrantId !== manifest.capabilityGrantId) {
    throw new Error('Invocation manifest does not match the execution scope grant');
  }

  if (input.capabilitySnapshotId !== manifest.capabilitySnapshotId) {
    throw new Error('Invocation manifest does not match the capability snapshot');
  }

  const entry = manifest.entries.find((candidate) => candidate.toolName === input.toolName);
  if (!entry) {
    throw new Error(`Tool is not authorized by the invocation manifest: ${input.toolName}`);
  }

  return entry;
}
