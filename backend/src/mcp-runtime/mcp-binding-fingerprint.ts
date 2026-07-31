import { createHash } from 'node:crypto';
import {
  getActionInputIds,
  getExposedParameterIds,
  getToolMetadata,
  type ComponentDefinition,
} from '@sentris/component-sdk';
import type { JsonSchemaDocument, McpToolRegistrationDescriptor } from '@sentris/shared';

export interface McpBindingSource {
  nodeId: string;
  toolName: string;
  type: string;
  providerKind?: string;
  exposedToAgent?: boolean;
  status: string;
  componentId?: string;
  parameters?: Record<string, unknown>;
  inputSchema: JsonSchemaDocument;
  description: string;
  encryptedCredentials?: string;
  endpoint?: string;
  containerId?: string;
  serverId?: string;
}

export function computeMcpBindingFingerprint(
  source: McpBindingSource,
  publicDescriptors: readonly McpToolRegistrationDescriptor[],
  componentDefinition?: ComponentDefinition,
): string {
  if (source.type === 'component' && !componentDefinition) {
    throw new Error('Component definition is required for an MCP component binding');
  }
  const credentialVersionHash = source.encryptedCredentials
    ? sha256(source.encryptedCredentials)
    : undefined;
  return sha256(
    stableJson({
      source: {
        nodeId: source.nodeId.trim(),
        toolName: source.toolName.trim(),
        type: source.type,
        providerKind: source.providerKind,
        exposedToAgent: source.exposedToAgent,
        status: source.status,
        componentId: source.componentId,
        parameters: source.parameters,
        inputSchema: source.inputSchema,
        description: source.description,
        endpoint: source.endpoint,
        containerId: source.containerId,
        serverId: source.serverId,
        credentialVersionHash,
      },
      publicDescriptors,
      componentDefinition: componentDefinition
        ? componentDispatchDefinitionProjection(componentDefinition)
        : undefined,
    }),
  );
}

export function componentDispatchDefinitionProjection(component: ComponentDefinition): unknown {
  const metadata = getToolMetadata(component);
  return stableJson({
    componentId: component.id,
    version: component.ui?.version,
    providerKind: component.toolProvider?.kind,
    tool: metadata,
    actionInputIds: [...getActionInputIds(component)].sort(),
    exposedParameterIds: [...getExposedParameterIds(component)].sort(),
  });
}

export function sha256(value: unknown): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(stableJson(value)))
    .digest('hex');
}

export function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJson);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => {
        const child = (value as Record<string, unknown>)[key];
        return child === undefined ? [] : [[key, stableJson(child)]];
      }),
  );
}
