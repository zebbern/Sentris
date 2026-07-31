import { z } from 'zod';

export const MCP_CAPABILITY_CONTRACT_VERSION = '1' as const;

export const ExecutionScopeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('run'),
      organizationId: z.string().min(1).nullable(),
      runId: z.string().min(1),
      capabilityGrantId: z.string().uuid(),
      invokingNodeId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('studio'),
      organizationId: z.string().min(1).nullable(),
      operationId: z.string().uuid(),
      capabilityGrantId: z.string().uuid(),
      expiresAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('discovery'),
      organizationId: z.string().min(1).nullable(),
      operationId: z.string().uuid(),
      capabilityGrantId: z.string().uuid(),
      expiresAt: z.string().datetime(),
    })
    .strict(),
]);
export type ExecutionScope = z.infer<typeof ExecutionScopeSchema>;

export const CapabilityToolAccessSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z
    .object({
      mode: z.literal('subset'),
      names: z.array(z.string().min(1)).min(1),
    })
    .strict(),
]);
export type CapabilityToolAccess = z.infer<typeof CapabilityToolAccessSchema>;

export const CapabilityGrantSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().min(1).nullable(),
    subject: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('run'), runId: z.string().min(1) }).strict(),
      z
        .object({
          kind: z.literal('studio'),
          operationId: z.string().uuid(),
          expiresAt: z.string().datetime(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('discovery'),
          operationId: z.string().uuid(),
          expiresAt: z.string().datetime(),
        })
        .strict(),
    ]),
    sources: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          toolAccess: CapabilityToolAccessSchema,
        })
        .strict(),
    ),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((grant, context) => {
    const seen = new Set<string>();
    for (const source of grant.sources) {
      if (seen.has(source.sourceId)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate capability source: ${source.sourceId}`,
          path: ['sources'],
        });
      }
      seen.add(source.sourceId);
    }
  });
export type CapabilityGrant = z.infer<typeof CapabilityGrantSchema>;

export const JsonSchemaDocumentSchema = z.record(z.string(), z.unknown());
export type JsonSchemaDocument = z.infer<typeof JsonSchemaDocumentSchema>;

export const McpIconSchema = z
  .object({
    src: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    sizes: z.array(z.string().min(1)).optional(),
    theme: z.enum(['light', 'dark']).optional(),
  })
  .strict();
export type McpIcon = z.infer<typeof McpIconSchema>;

/**
 * SDK-independent MCP tool shape used by the worker-to-backend registration boundary.
 * `_meta` intentionally retains its MCP wire name at this existing protocol boundary.
 */
export const McpToolRegistrationDescriptorSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: JsonSchemaDocumentSchema.optional(),
  outputSchema: JsonSchemaDocumentSchema.optional(),
  icons: z.array(McpIconSchema).optional(),
  annotations: z.record(z.string(), z.unknown()).optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});
export type McpToolRegistrationDescriptor = z.infer<
  typeof McpToolRegistrationDescriptorSchema
>;

export const ComponentToolSourceSchema = z
  .object({
    kind: z.literal('component'),
    sourceId: z.string().min(1),
    nodeId: z.string().min(1),
    componentId: z.string().min(1),
    bindingFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ComponentToolSource = z.infer<typeof ComponentToolSourceSchema>;

export const McpToolSourceSchema = z
  .object({
    kind: z.literal('mcp'),
    sourceId: z.string().min(1),
    serverId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    upstreamName: z.string().min(1),
    bindingFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type McpToolSource = z.infer<typeof McpToolSourceSchema>;

export const ToolDescriptorSchema = z
  .object({
    canonicalName: z.string().min(1).max(128),
    displayName: z.string().min(1),
    description: z.string().optional(),
    inputSchema: JsonSchemaDocumentSchema,
    outputSchema: JsonSchemaDocumentSchema.optional(),
    source: z.discriminatedUnion('kind', [ComponentToolSourceSchema, McpToolSourceSchema]),
    title: z.string().optional(),
    icons: z.array(McpIconSchema).optional(),
    annotations: z.record(z.string(), z.unknown()).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    effects: z.enum(['read-only', 'idempotent', 'mutating', 'unknown']),
    effectsSource: z.enum(['sentris-contract', 'operator-policy', 'mcp-annotation', 'unknown']),
    retryPolicy: z.enum(['pre-dispatch-only', 'reviewed-idempotent']),
  })
  .strict();
export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;

const CapabilityMetadataSchema = z
  .object({
    sourceId: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    icons: z.array(McpIconSchema).optional(),
    annotations: z.record(z.string(), z.unknown()).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ResourceDescriptorSchema = CapabilityMetadataSchema.extend({
  uri: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
}).strict();
export type ResourceDescriptor = z.infer<typeof ResourceDescriptorSchema>;

export const ResourceTemplateDescriptorSchema = CapabilityMetadataSchema.extend({
  uriTemplate: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().optional(),
}).strict();
export type ResourceTemplateDescriptor = z.infer<typeof ResourceTemplateDescriptorSchema>;

export const PromptDescriptorSchema = CapabilityMetadataSchema.extend({
  name: z.string().min(1),
  arguments: z.array(
    z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        required: z.boolean().optional(),
      })
      .strict(),
  ),
}).strict();
export type PromptDescriptor = z.infer<typeof PromptDescriptorSchema>;

export const McpCapabilityCatalogSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    scope: ExecutionScopeSchema,
    version: z.literal(MCP_CAPABILITY_CONTRACT_VERSION),
    configFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    tools: z.array(ToolDescriptorSchema),
    resources: z.array(ResourceDescriptorSchema),
    resourceTemplates: z.array(ResourceTemplateDescriptorSchema),
    prompts: z.array(PromptDescriptorSchema),
    createdAt: z.string().datetime(),
  })
  .strict();
export type McpCapabilityCatalogSnapshot = z.infer<
  typeof McpCapabilityCatalogSnapshotSchema
>;
