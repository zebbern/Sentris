import { Injectable } from '@nestjs/common';
import {
  CapabilityGrantSchema,
  MCP_CAPABILITY_CONTRACT_VERSION,
  MCP_LEGACY_CAPABILITY_CONTRACT_VERSION,
  McpCapabilityCatalogSnapshotSchema,
  buildInvocationManifest,
  type CapabilityGrant,
  type ExecutionScope,
  type McpCapabilityCatalogSnapshot,
} from '@sentris/shared';

import { sha256 } from './mcp-binding-fingerprint';
import { McpRunCatalogService } from './mcp-run-catalog.service';
import { McpRuntimeRepository, type StoredMcpAuthority } from './mcp-runtime.repository';

@Injectable()
export class McpRunAuthorityService {
  constructor(
    private readonly catalog: McpRunCatalogService,
    private readonly repository: McpRuntimeRepository,
  ) {}

  async materialize(input: {
    runId: string;
    organizationId: string | null;
    invokingNodeId?: string;
    allowedNodeIds: readonly string[];
    contractVersion:
      | typeof MCP_LEGACY_CAPABILITY_CONTRACT_VERSION
      | typeof MCP_CAPABILITY_CONTRACT_VERSION;
  }): Promise<StoredMcpAuthority> {
    const allowedNodeIds = normalizeAllowedNodeIds(input.allowedNodeIds);
    const built = await this.catalog.build({
      runId: input.runId,
      organizationId: input.organizationId,
      ...(input.invokingNodeId !== undefined && { invokingNodeId: input.invokingNodeId }),
      allowedNodeIds,
    });
    const authorityKey = sha256([
      input.contractVersion,
      {
        kind: 'run',
        runId: input.runId,
        organizationId: input.organizationId,
        invokingNodeId: input.invokingNodeId ?? null,
      },
      allowedNodeIds,
      built.configFingerprint,
    ]);
    const grantId = stableUuid('mcp-run-grant', authorityKey);
    const snapshotId = stableUuid('mcp-run-snapshot', authorityKey);
    const createdAt = new Date().toISOString();
    const scope: ExecutionScope = {
      kind: 'run',
      runId: input.runId,
      organizationId: input.organizationId,
      capabilityGrantId: grantId,
      ...(input.invokingNodeId !== undefined && { invokingNodeId: input.invokingNodeId }),
    };
    const sourceIds = [
      ...new Set([
        ...built.tools.map((tool) => tool.source.sourceId),
        ...built.resources.map((resource) => resource.sourceId),
        ...built.resourceTemplates.map((template) => template.sourceId),
        ...built.prompts.map((prompt) => prompt.sourceId),
      ]),
    ].sort();
    const grant: CapabilityGrant = CapabilityGrantSchema.parse({
      id: grantId,
      organizationId: input.organizationId,
      subject: { kind: 'run', runId: input.runId },
      sources: sourceIds.map((sourceId) => ({
        sourceId,
        toolAccess: { mode: 'all' as const },
      })),
      createdAt,
    });
    const snapshot: McpCapabilityCatalogSnapshot = McpCapabilityCatalogSnapshotSchema.parse({
      id: snapshotId,
      scope,
      version: input.contractVersion,
      configFingerprint: built.configFingerprint,
      ...(input.contractVersion === MCP_CAPABILITY_CONTRACT_VERSION && {
        runtimeBindings: built.runtimeBindings,
      }),
      tools: built.tools,
      resources: built.resources,
      resourceTemplates: built.resourceTemplates,
      prompts: built.prompts,
      createdAt,
    });
    const manifest = buildInvocationManifest(snapshot, grant);

    return this.repository.createOrReadRunAuthority({
      authorityKey,
      grant,
      snapshot,
      manifest,
    });
  }
}

function normalizeAllowedNodeIds(nodeIds: readonly string[]): string[] {
  return [...new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))].sort();
}

function stableUuid(domain: string, authorityKey: string): string {
  const bytes = Buffer.from(sha256([domain, authorityKey]).slice(0, 32), 'hex');
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
