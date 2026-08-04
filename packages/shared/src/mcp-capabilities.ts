import { z } from 'zod';

export const MCP_LEGACY_CAPABILITY_CONTRACT_VERSION = '1' as const;
export const MCP_CAPABILITY_CONTRACT_VERSION = '2' as const;
export const SENTRIS_MCP_SOURCE_NAME_META_KEY = 'com.sentris/source-name' as const;

export const AgentCapabilityTraceSchema = z
  .object({
    kind: z.enum(['tool', 'resource', 'prompt']),
    displayName: z.string().min(1),
    sourceId: z.string().min(1),
    sourceName: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
  })
  .strict();
export type AgentCapabilityTrace = z.infer<typeof AgentCapabilityTraceSchema>;

const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const McpRuntimeTransportSchema = z.enum(['http', 'stdio']);
export type McpRuntimeTransport = z.infer<typeof McpRuntimeTransportSchema>;

export const McpRuntimeStateSchema = z.enum(['starting', 'ready', 'draining']);
export type McpRuntimeState = z.infer<typeof McpRuntimeStateSchema>;

export const McpProtocolEraSchema = z.enum(['modern', 'legacy']);
export type McpProtocolEra = z.infer<typeof McpProtocolEraSchema>;

export const McpRuntimeOwnerAddressSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.username === '' &&
        url.password === '' &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === ''
      );
    } catch {
      return false;
    }
  }, 'Expected an HTTP(S) owner origin without credentials, path, query, or fragment');
export type McpRuntimeOwnerAddress = z.infer<typeof McpRuntimeOwnerAddressSchema>;

export const McpRuntimeKeySchema = z
  .object({
    sourceId: z.string().min(1),
    transport: McpRuntimeTransportSchema,
    configFingerprint: Sha256HexSchema,
    organizationId: z.string().min(1).nullable(),
    principalPartitionHash: Sha256HexSchema,
    credentialReference: z.string().min(1).nullable(),
    credentialGeneration: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((key, context) => {
    if ((key.credentialReference === null) !== (key.credentialGeneration === null)) {
      context.addIssue({
        code: 'custom',
        path: ['credentialGeneration'],
        message: 'Credential reference and generation must both be present or both be null',
      });
    }
  });
export type McpRuntimeKey = z.infer<typeof McpRuntimeKeySchema>;

const McpRuntimeDefinitionBaseSchema = z
  .object({
    sourceId: z.string().min(1),
    configFingerprint: Sha256HexSchema,
    bindingFingerprint: Sha256HexSchema,
    expectedCapabilityFingerprint: Sha256HexSchema.optional(),
    authority: z
      .object({
        authorityId: z.string().min(1),
        snapshotId: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

const McpRuntimeEnvironmentSchema = z.record(z.string().min(1), z.string());
const McpRuntimeArgumentsSchema = z.array(z.string()).max(128);
const McpDockerOpaqueOptionSchema = z
  .string()
  .min(1)
  .max(8_192)
  .refine((value) => !value.includes('\0'), 'Docker option values may not contain NUL bytes');
const McpDockerEntrypointSchema = z
  .string()
  .max(8_192)
  .refine((value) => !value.includes('\0'), 'Docker entrypoints may not contain NUL bytes');
const McpDockerRuntimeDefinitionShape = {
  image: z.string().min(1),
  command: McpRuntimeArgumentsSchema.optional(),
  environment: McpRuntimeEnvironmentSchema.optional(),
  network: z.string().min(1).optional(),
  volumes: z.array(McpDockerOpaqueOptionSchema).max(64).optional(),
  mounts: z.array(McpDockerOpaqueOptionSchema).max(64).optional(),
  workingDirectory: z
    .string()
    .min(1)
    .max(4_096)
    .refine(
      (value) => !value.includes('\0'),
      'Docker working directories may not contain NUL bytes',
    )
    .optional(),
  user: z
    .string()
    .min(1)
    .max(256)
    .refine((value) => !value.includes('\0'), 'Docker users may not contain NUL bytes')
    .optional(),
  entrypoint: McpDockerEntrypointSchema.optional(),
  readOnlyRootFilesystem: z.boolean().optional(),
  init: z.boolean().optional(),
} as const;

export const McpResolvedRuntimeDefinitionSchema = z.discriminatedUnion('kind', [
  McpRuntimeDefinitionBaseSchema.extend({
    kind: z.literal('remote-http'),
    endpoint: z.url(),
    headers: z.record(z.string().min(1), z.string()).optional(),
    allowedInternalHosts: z.array(z.string().min(1)).max(64).optional(),
  }).strict(),
  McpRuntimeDefinitionBaseSchema.extend({
    kind: z.literal('host-stdio'),
    command: z.string().min(1),
    args: McpRuntimeArgumentsSchema.optional(),
    cwd: z.string().min(1).optional(),
    environment: McpRuntimeEnvironmentSchema.optional(),
    allowedCwdRoots: z.array(z.string().min(1)).max(64).optional(),
  }).strict(),
  McpRuntimeDefinitionBaseSchema.extend({
    kind: z.literal('docker-stdio'),
    ...McpDockerRuntimeDefinitionShape,
  }).strict(),
  McpRuntimeDefinitionBaseSchema.extend({
    kind: z.literal('docker-http'),
    ...McpDockerRuntimeDefinitionShape,
    containerPort: z.number().int().positive().max(65_535),
    endpointPath: z.string().startsWith('/').optional(),
    dindHost: z.string().min(1).optional(),
  }).strict(),
]);
export type McpResolvedRuntimeDefinition = z.infer<typeof McpResolvedRuntimeDefinitionSchema>;

export const McpRuntimeFenceSchema = z
  .object({
    runtimeId: z.string().uuid(),
    ownerId: z.string().min(1),
    ownerEpoch: z.string().uuid(),
    leaseGeneration: z.number().int().positive(),
  })
  .strict();
export type McpRuntimeFence = z.infer<typeof McpRuntimeFenceSchema>;

export const McpRuntimeHolderIdSchema = z.string().uuid();
export type McpRuntimeHolderId = z.infer<typeof McpRuntimeHolderIdSchema>;

export const McpRuntimeAcquireRequestSchema = z
  .object({
    runtimeKey: McpRuntimeKeySchema,
    candidateOwner: z
      .object({
        ownerId: z.string().min(1),
        ownerEpoch: z.string().uuid(),
        ownerAddress: McpRuntimeOwnerAddressSchema,
      })
      .strict(),
  })
  .strict();
export type McpRuntimeAcquireRequest = z.infer<typeof McpRuntimeAcquireRequestSchema>;

const McpRuntimeRefBaseShape = {
  fence: McpRuntimeFenceSchema,
  leaseExpiresAt: z.string().datetime(),
};

const publishedMcpRuntimeRef = <TState extends 'ready' | 'draining'>(state: TState) =>
  z
    .object({
      ...McpRuntimeRefBaseShape,
      protocolEra: McpProtocolEraSchema,
      protocolVersion: z.string().min(1),
      ownerAddress: McpRuntimeOwnerAddressSchema,
      state: z.literal(state),
      capabilityFingerprint: Sha256HexSchema,
    })
    .strict();

export const McpReadyRuntimeRefSchema = publishedMcpRuntimeRef('ready');
export type McpReadyRuntimeRef = z.infer<typeof McpReadyRuntimeRefSchema>;

export const McpRuntimeRefSchema = z.discriminatedUnion('state', [
  z
    .object({
      ...McpRuntimeRefBaseShape,
      protocolEra: z.null(),
      protocolVersion: z.null(),
      ownerAddress: z.null(),
      state: z.literal('starting'),
      capabilityFingerprint: z.null(),
    })
    .strict(),
  McpReadyRuntimeRefSchema,
  publishedMcpRuntimeRef('draining'),
]);
export type McpRuntimeRef = z.infer<typeof McpRuntimeRefSchema>;

export const McpRuntimeAcquisitionSchema = z
  .object({
    ref: McpReadyRuntimeRefSchema,
    holderId: McpRuntimeHolderIdSchema,
  })
  .strict();
export type McpRuntimeAcquisition = z.infer<typeof McpRuntimeAcquisitionSchema>;

export const McpRuntimeHealthSchema = z
  .object({
    fence: McpRuntimeFenceSchema,
    state: McpRuntimeStateSchema,
    status: z.enum(['healthy', 'unhealthy', 'unknown']),
    checkedAt: z.string().datetime(),
    leaseExpiresAt: z.string().datetime(),
  })
  .strict();
export type McpRuntimeHealth = z.infer<typeof McpRuntimeHealthSchema>;

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
  z
    .object({
      kind: z.literal('operator'),
      organizationId: z.string().min(1),
      sessionId: z.string().uuid(),
      turnId: z.string().uuid(),
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
      z
        .object({
          kind: z.literal('operator'),
          sessionId: z.string().uuid(),
          turnId: z.string().uuid(),
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
export type McpToolRegistrationDescriptor = z.infer<typeof McpToolRegistrationDescriptorSchema>;

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

export const McpCatalogSchema = z
  .object({
    protocolEra: McpProtocolEraSchema,
    protocolVersion: z.string().min(1),
    capabilityFingerprint: Sha256HexSchema,
    tools: z.array(ToolDescriptorSchema),
    resources: z.array(ResourceDescriptorSchema),
    resourceTemplates: z.array(ResourceTemplateDescriptorSchema),
    prompts: z.array(PromptDescriptorSchema),
  })
  .strict();
export type McpCatalog = z.infer<typeof McpCatalogSchema>;

export const McpSnapshotRuntimeBindingSchema = z
  .object({
    runtimeKey: McpRuntimeKeySchema,
    protocolEra: McpProtocolEraSchema,
    protocolVersion: z.string().min(1),
    capabilityFingerprint: Sha256HexSchema,
  })
  .strict();
export type McpSnapshotRuntimeBinding = z.infer<typeof McpSnapshotRuntimeBindingSchema>;

const McpCapabilityCatalogSnapshotBaseShape = {
  id: z.string().uuid(),
  scope: ExecutionScopeSchema,
  configFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  tools: z.array(ToolDescriptorSchema),
  resources: z.array(ResourceDescriptorSchema),
  resourceTemplates: z.array(ResourceTemplateDescriptorSchema),
  prompts: z.array(PromptDescriptorSchema),
  createdAt: z.string().datetime(),
} as const;

export const LegacyMcpCapabilityCatalogSnapshotSchema = z
  .object({
    ...McpCapabilityCatalogSnapshotBaseShape,
    version: z.literal(MCP_LEGACY_CAPABILITY_CONTRACT_VERSION),
  })
  .strict();
export const DurableMcpCapabilityCatalogSnapshotSchema = z
  .object({
    ...McpCapabilityCatalogSnapshotBaseShape,
    version: z.literal(MCP_CAPABILITY_CONTRACT_VERSION),
    runtimeBindings: z.record(z.string().min(1), McpSnapshotRuntimeBindingSchema),
  })
  .strict();
export const McpCapabilityCatalogSnapshotSchema = z.discriminatedUnion('version', [
  LegacyMcpCapabilityCatalogSnapshotSchema,
  DurableMcpCapabilityCatalogSnapshotSchema,
]);
export type McpCapabilityCatalogSnapshot = z.infer<typeof McpCapabilityCatalogSnapshotSchema>;

export function mcpSnapshotRuntimeBindings(
  snapshot: McpCapabilityCatalogSnapshot,
): Readonly<Record<string, McpSnapshotRuntimeBinding>> {
  return snapshot.version === MCP_CAPABILITY_CONTRACT_VERSION ? snapshot.runtimeBindings : {};
}
