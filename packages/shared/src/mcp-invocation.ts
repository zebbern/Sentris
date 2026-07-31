import { z } from 'zod';
import {
  MCP_CAPABILITY_CONTRACT_VERSION,
  type CapabilityGrant,
  type ExecutionScope,
  type McpCapabilityCatalogSnapshot,
  type ToolDescriptor,
} from './mcp-capabilities.js';

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
    entries: z.array(InvocationManifestEntrySchema).readonly(),
  })
  .strict()
  .readonly();
export type InvocationManifest = z.infer<typeof InvocationManifestSchema>;

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
