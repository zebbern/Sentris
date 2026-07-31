import { Injectable } from '@nestjs/common';
import type { McpToolRegistrationDescriptor, ToolDescriptor } from '@sentris/shared';

import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';
import { McpLegacyOutboundCompatibilityService } from '../mcp/mcp-legacy-outbound-compatibility.service';
import { ToolRegistryService, type RegisteredTool } from '../mcp/tool-registry.service';
import { computeMcpBindingFingerprint, sha256 } from './mcp-binding-fingerprint';
import { claimMcpToolName, externalMcpToolName } from './mcp-tool-name';

export interface BuiltRunCatalog {
  tools: ToolDescriptor[];
  configFingerprint: string;
}

@Injectable()
export class McpRunCatalogService {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly mcpServersRepository: McpServersRepository,
    private readonly legacyOutbound: McpLegacyOutboundCompatibilityService,
  ) {}

  async build(input: {
    runId: string;
    allowedNodeIds: readonly string[];
  }): Promise<BuiltRunCatalog> {
    const allowedNodeIds = normalizeAllowedNodeIds(input.allowedNodeIds);
    const registered = await this.toolRegistry.getToolsForRun(input.runId, allowedNodeIds);
    const sources = registered
      .filter((source) => source.status === 'ready')
      .filter((source) => source.exposedToAgent !== false)
      .filter((source) => isNodeAllowed(source.nodeId, allowedNodeIds))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId));

    const tools: ToolDescriptor[] = [];
    const claimedNames = new Set<string>();
    const sourceFingerprints: { sourceId: string; bindingFingerprint: string }[] = [];

    for (const source of sources) {
      if (source.type === 'component') {
        const descriptor = componentRegistrationDescriptor(source);
        const bindingFingerprint = computeMcpBindingFingerprint(source, [descriptor]);
        claimMcpToolName(claimedNames, source.toolName);
        tools.push(componentToolDescriptor(source, descriptor, bindingFingerprint));
        sourceFingerprints.push({ sourceId: source.nodeId, bindingFingerprint });
        continue;
      }

      const discovered = (await this.discoverExternalTools(input.runId, source)).sort(
        (left, right) => left.name.localeCompare(right.name),
      );
      const bindingFingerprint = computeMcpBindingFingerprint(source, discovered);
      sourceFingerprints.push({ sourceId: source.nodeId, bindingFingerprint });
      for (const upstream of discovered) {
        const canonicalName = externalMcpToolName(source.toolName, upstream.name);
        claimMcpToolName(claimedNames, canonicalName);
        tools.push(externalToolDescriptor(source, upstream, canonicalName, bindingFingerprint));
      }
    }

    tools.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
    sourceFingerprints.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    return {
      tools,
      configFingerprint: sha256({ sourceFingerprints, tools }),
    };
  }

  private async discoverExternalTools(
    runId: string,
    source: RegisteredTool,
  ): Promise<McpToolRegistrationDescriptor[]> {
    const cached = await this.toolRegistry.getServerTools(runId, source.nodeId);
    if (cached && cached.length > 0) return cached;

    if (source.type === 'mcp-server' || source.type === 'local-mcp') {
      return source.endpoint ? this.legacyOutbound.discoverTools(runId, source) : [];
    }

    if (!source.serverId) return [];
    const records = await this.mcpServersRepository.listTools(source.serverId);
    return records
      .filter((record) => record.enabled)
      .map((record) => ({
        name: record.toolName,
        description: record.description ?? undefined,
        inputSchema: (record.inputSchema as Record<string, unknown> | null) ?? undefined,
      }));
  }
}

function componentRegistrationDescriptor(source: RegisteredTool): McpToolRegistrationDescriptor {
  return {
    name: source.toolName,
    description: source.description,
    inputSchema: closeObjectSchema(source.inputSchema),
  };
}

function componentToolDescriptor(
  source: RegisteredTool,
  descriptor: McpToolRegistrationDescriptor,
  bindingFingerprint: string,
): ToolDescriptor {
  if (!source.componentId) {
    throw new Error(`Component ID missing for tool '${source.toolName}'`);
  }
  return {
    canonicalName: source.toolName,
    displayName: source.toolName,
    description: source.description,
    inputSchema: descriptor.inputSchema ?? closeObjectSchema(source.inputSchema),
    source: {
      kind: 'component',
      sourceId: source.nodeId,
      nodeId: source.nodeId,
      componentId: source.componentId,
      bindingFingerprint,
    },
    effects: 'unknown',
    effectsSource: 'sentris-contract',
    retryPolicy: 'pre-dispatch-only',
  };
}

function externalToolDescriptor(
  source: RegisteredTool,
  upstream: McpToolRegistrationDescriptor,
  canonicalName: string,
  bindingFingerprint: string,
): ToolDescriptor {
  const readOnly = upstream.annotations?.readOnlyHint === true;
  const idempotent = upstream.annotations?.idempotentHint === true;
  return {
    canonicalName,
    displayName: upstream.title ?? upstream.name,
    ...(upstream.title !== undefined && { title: upstream.title }),
    ...(upstream.description !== undefined && { description: upstream.description }),
    inputSchema: upstream.inputSchema ?? { type: 'object' },
    ...(upstream.outputSchema !== undefined && { outputSchema: upstream.outputSchema }),
    ...(upstream.icons !== undefined && { icons: upstream.icons }),
    ...(upstream.annotations !== undefined && { annotations: upstream.annotations }),
    ...(upstream._meta !== undefined && { meta: upstream._meta }),
    source: {
      kind: 'mcp',
      sourceId: source.nodeId,
      nodeId: source.nodeId,
      ...(source.serverId !== undefined && { serverId: source.serverId }),
      upstreamName: upstream.name,
      bindingFingerprint,
    },
    effects: readOnly ? 'read-only' : 'unknown',
    effectsSource: readOnly || idempotent ? 'mcp-annotation' : 'unknown',
    retryPolicy: readOnly || idempotent ? 'reviewed-idempotent' : 'pre-dispatch-only',
  };
}

function closeObjectSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type !== 'object' && schema.properties === undefined) {
    return schema;
  }
  return { ...schema, additionalProperties: false };
}

function normalizeAllowedNodeIds(nodeIds: readonly string[]): string[] {
  return [...new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))].sort();
}

function isNodeAllowed(nodeId: string, allowedNodeIds: readonly string[]): boolean {
  return (
    allowedNodeIds.length === 0 ||
    allowedNodeIds.some((allowed) => nodeId === allowed || nodeId.startsWith(`${allowed}/`))
  );
}
