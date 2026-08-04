import { Injectable } from '@nestjs/common';
import { componentRegistry } from '@sentris/component-sdk';
import {
  SENTRIS_MCP_SOURCE_NAME_META_KEY,
  type McpCatalog,
  type McpRuntimeKey,
  type McpSnapshotRuntimeBinding,
  type McpToolRegistrationDescriptor,
  type PromptDescriptor,
  type ResourceDescriptor,
  type ResourceTemplateDescriptor,
  type ToolDescriptor,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { McpSavedServerRuntimeService } from '../mcp-servers/mcp-saved-server-runtime.service';
import { McpServerRuntimeConfigService } from '../mcp-servers/mcp-server-runtime-config.service';
import { McpLegacyOutboundCompatibilityService } from '../mcp/mcp-legacy-outbound-compatibility.service';
import { ToolRegistryService, type RegisteredTool } from '../mcp/tool-registry.service';
import { computeMcpBindingFingerprint, sha256 } from './mcp-binding-fingerprint';
import { claimMcpToolName, externalMcpToolName } from './mcp-tool-name';

export interface BuiltRunCatalog {
  tools: ToolDescriptor[];
  resources: ResourceDescriptor[];
  resourceTemplates: ResourceTemplateDescriptor[];
  prompts: PromptDescriptor[];
  runtimeBindings: Record<string, McpSnapshotRuntimeBinding>;
  configFingerprint: string;
}

@Injectable()
export class McpRunCatalogService {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly legacyOutbound: McpLegacyOutboundCompatibilityService,
    private readonly runtimeConfig: McpServerRuntimeConfigService,
    private readonly savedServerDiscovery: McpSavedServerRuntimeService,
  ) {}

  async build(input: {
    runId: string;
    organizationId: string | null;
    invokingNodeId?: string;
    allowedNodeIds: readonly string[];
    /** Explicitly false when an empty allowlist means no sources rather than legacy all-sources. */
    allowAllSources?: boolean;
  }): Promise<BuiltRunCatalog> {
    const allowedNodeIds = normalizeAllowedNodeIds(input.allowedNodeIds);
    const registered = await this.toolRegistry.getToolsForRun(input.runId, allowedNodeIds);
    const allowAllSources = allowedNodeIds.length === 0 && input.allowAllSources !== false;
    const sources = registered
      .filter((source) => source.status === 'ready')
      .filter((source) => source.exposedToAgent !== false)
      .filter((source) => allowAllSources || isNodeAllowed(source.nodeId, allowedNodeIds))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId));

    const tools: ToolDescriptor[] = [];
    const resources: ResourceDescriptor[] = [];
    const resourceTemplates: ResourceTemplateDescriptor[] = [];
    const prompts: PromptDescriptor[] = [];
    const claimedNames = new Set<string>();
    const sourceFingerprints: {
      sourceId: string;
      bindingFingerprint: string;
      runtimeIdentity?: {
        runtimeKey: McpRuntimeKey;
        protocolEra: McpCatalog['protocolEra'];
        protocolVersion: string;
        capabilityFingerprint: string;
      };
    }[] = [];

    for (const source of sources) {
      if (source.type === 'component') {
        const descriptor = componentRegistrationDescriptor(source);
        const component = source.componentId
          ? componentRegistry.get(source.componentId)
          : undefined;
        if (!component) {
          throw new Error(`Component definition missing for tool '${source.toolName}'`);
        }
        const bindingFingerprint = computeMcpBindingFingerprint(source, [descriptor], component);
        claimMcpToolName(claimedNames, source.toolName);
        tools.push(componentToolDescriptor(source, descriptor, bindingFingerprint));
        sourceFingerprints.push({ sourceId: source.nodeId, bindingFingerprint });
        continue;
      }

      const discovered = await this.discoverExternalCatalog(input, source);
      const registrations = discovered.tools
        .map(toRegistrationDescriptor)
        .sort((left, right) => left.name.localeCompare(right.name));
      const bindingFingerprint = computeMcpBindingFingerprint(source, registrations);
      sourceFingerprints.push({
        sourceId: source.nodeId,
        bindingFingerprint,
        ...(discovered.kind === 'saved'
          ? {
              runtimeIdentity: {
                runtimeKey: discovered.runtimeKey,
                protocolEra: discovered.catalog.protocolEra,
                protocolVersion: discovered.catalog.protocolVersion,
                capabilityFingerprint: discovered.catalog.capabilityFingerprint,
              },
            }
          : {}),
      });
      for (const upstream of registrations) {
        const canonicalName = externalMcpToolName(source.toolName, upstream.name);
        claimMcpToolName(claimedNames, canonicalName);
        tools.push(externalToolDescriptor(source, upstream, canonicalName, bindingFingerprint));
      }
      if (discovered.kind === 'saved') {
        resources.push(
          ...discovered.catalog.resources.map((descriptor) => ({
            ...descriptor,
            sourceId: source.nodeId,
            meta: capabilitySourceMeta(descriptor.meta, source),
          })),
        );
        resourceTemplates.push(
          ...discovered.catalog.resourceTemplates.map((descriptor) => ({
            ...descriptor,
            sourceId: source.nodeId,
            meta: capabilitySourceMeta(descriptor.meta, source),
          })),
        );
        prompts.push(
          ...discovered.catalog.prompts.map((descriptor) => ({
            ...descriptor,
            sourceId: source.nodeId,
            meta: capabilitySourceMeta(descriptor.meta, source),
          })),
        );
      }
    }

    tools.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
    resources.sort(compareResources);
    resourceTemplates.sort(compareResourceTemplates);
    prompts.sort(comparePrompts);
    sourceFingerprints.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    const runtimeBindings = Object.fromEntries(
      sourceFingerprints.flatMap(({ sourceId, runtimeIdentity }) =>
        runtimeIdentity ? [[sourceId, runtimeIdentity] as const] : [],
      ),
    );
    return {
      tools,
      resources,
      resourceTemplates,
      prompts,
      runtimeBindings,
      configFingerprint: sha256({
        sourceFingerprints,
        tools,
        resources,
        resourceTemplates,
        prompts,
      }),
    };
  }

  private async discoverExternalCatalog(
    input: {
      runId: string;
      organizationId: string | null;
      invokingNodeId?: string;
    },
    source: RegisteredTool,
  ): Promise<
    | { kind: 'saved'; runtimeKey: McpRuntimeKey; catalog: McpCatalog; tools: ToolDescriptor[] }
    | { kind: 'legacy-tool-only'; tools: McpToolRegistrationDescriptor[] }
  > {
    if (source.serverId) {
      const policyTools = await this.toolRegistry.getServerTools(input.runId, source.nodeId);
      if (!policyTools) {
        throw new Error(
          `MCP tool policy missing for saved server '${source.serverId}' at node '${source.nodeId}'`,
        );
      }
      const allowedToolNames = new Set(policyTools.map((tool) => tool.name));
      const runtimeKey = await this.runtimeConfig.buildRuntimeKey(
        runPrincipal(input.runId, input.organizationId),
        source.serverId,
      );
      const catalog = await this.savedServerDiscovery.discover(runtimeKey);
      return {
        kind: 'saved',
        runtimeKey,
        catalog,
        tools: catalog.tools.filter((tool) =>
          allowedToolNames.has(toRegistrationDescriptor(tool).name),
        ),
      };
    }

    const cached = await this.toolRegistry.getServerTools(input.runId, source.nodeId);
    if (cached && cached.length > 0) return { kind: 'legacy-tool-only', tools: cached };

    if (source.type === 'mcp-server' || source.type === 'local-mcp') {
      return {
        kind: 'legacy-tool-only',
        tools: source.endpoint ? await this.legacyOutbound.discoverTools(input.runId, source) : [],
      };
    }

    return { kind: 'legacy-tool-only', tools: [] };
  }
}

function runPrincipal(runId: string, organizationId: string | null): AuthContext {
  return {
    userId: `run:${runId}`,
    organizationId,
    roles: ['MEMBER'],
    isAuthenticated: true,
    provider: 'sentris-run',
  };
}

function toRegistrationDescriptor(
  descriptor: ToolDescriptor | McpToolRegistrationDescriptor,
): McpToolRegistrationDescriptor {
  if (!('canonicalName' in descriptor)) return descriptor;
  if (descriptor.source.kind !== 'mcp') {
    throw new Error('Saved MCP runtime catalog returned a non-MCP tool source');
  }
  return {
    name: descriptor.source.upstreamName,
    ...(descriptor.title !== undefined && { title: descriptor.title }),
    ...(descriptor.description !== undefined && { description: descriptor.description }),
    inputSchema: descriptor.inputSchema,
    ...(descriptor.outputSchema !== undefined && { outputSchema: descriptor.outputSchema }),
    ...(descriptor.icons !== undefined && { icons: descriptor.icons }),
    ...(descriptor.annotations !== undefined && { annotations: descriptor.annotations }),
    ...(descriptor.meta !== undefined && { _meta: descriptor.meta }),
  };
}

function compareResources(left: ResourceDescriptor, right: ResourceDescriptor): number {
  return compareCapabilityKeys(
    `${left.sourceId}\u0000${left.uri}\u0000${left.name}`,
    `${right.sourceId}\u0000${right.uri}\u0000${right.name}`,
  );
}

function compareResourceTemplates(
  left: ResourceTemplateDescriptor,
  right: ResourceTemplateDescriptor,
): number {
  return compareCapabilityKeys(
    `${left.sourceId}\u0000${left.uriTemplate}\u0000${left.name}`,
    `${right.sourceId}\u0000${right.uriTemplate}\u0000${right.name}`,
  );
}

function comparePrompts(left: PromptDescriptor, right: PromptDescriptor): number {
  return compareCapabilityKeys(
    `${left.sourceId}\u0000${left.name}`,
    `${right.sourceId}\u0000${right.name}`,
  );
}

function compareCapabilityKeys(left: string, right: string): number {
  return left.localeCompare(right);
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
    meta: capabilitySourceMeta(upstream._meta, source),
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

function capabilitySourceMeta(
  upstream: Record<string, unknown> | undefined,
  source: RegisteredTool,
): Record<string, unknown> {
  return {
    ...upstream,
    [SENTRIS_MCP_SOURCE_NAME_META_KEY]: source.toolName,
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
  return allowedNodeIds.some((allowed) => nodeId === allowed || nodeId.startsWith(`${allowed}/`));
}
