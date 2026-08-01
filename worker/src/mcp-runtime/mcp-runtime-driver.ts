import type {
  McpResolvedRuntimeDefinition,
  McpRuntimeFence,
  McpRuntimeKey,
  McpRuntimeOwnerAddress,
} from '@sentris/shared';

import type { McpClientAdapter } from './mcp-client-adapter';

export type McpRuntimeDefinition = McpResolvedRuntimeDefinition;
export type RemoteHttpRuntimeDefinition = Extract<McpRuntimeDefinition, { kind: 'remote-http' }>;
export type HostStdioRuntimeDefinition = Extract<McpRuntimeDefinition, { kind: 'host-stdio' }>;
export type DockerStdioRuntimeDefinition = Extract<McpRuntimeDefinition, { kind: 'docker-stdio' }>;
export type DockerHttpRuntimeDefinition = Extract<McpRuntimeDefinition, { kind: 'docker-http' }>;

export interface McpRuntimeDefinitionResolver {
  /** Called only by the winning lease owner, after reservation. */
  resolve(runtimeKey: McpRuntimeKey, signal: AbortSignal): Promise<McpRuntimeDefinition>;
}

export type McpRuntimeTransportHealth = 'healthy' | 'unhealthy' | 'unknown';

export interface McpRuntimeResource {
  kind: 'docker-container';
  resourceId: string;
  runtimeKeyHash: string;
  fence: McpRuntimeFence;
}

export interface McpRuntimeDriverHandle {
  readonly adapter: McpClientAdapter;
  readonly resource?: McpRuntimeResource;
  health(): Promise<McpRuntimeTransportHealth>;
  close(): Promise<void>;
}

export interface McpRuntimeDriverStartInput {
  runtimeKey: McpRuntimeKey;
  fence: McpRuntimeFence;
  ownerAddress: McpRuntimeOwnerAddress;
  definition: McpRuntimeDefinition;
  signal: AbortSignal;
  connectTimeoutMs: number;
}

export interface McpRuntimeDriver {
  readonly kinds: readonly McpRuntimeDefinition['kind'][];
  start(input: McpRuntimeDriverStartInput): Promise<McpRuntimeDriverHandle>;
  inventory(): Promise<McpRuntimeResource[]>;
  reap(resource: McpRuntimeResource): Promise<void>;
}

export class McpRuntimeDriverRegistry {
  private readonly byKind = new Map<McpRuntimeDefinition['kind'], McpRuntimeDriver>();

  constructor(drivers: readonly McpRuntimeDriver[]) {
    for (const driver of drivers) {
      for (const kind of driver.kinds) {
        if (this.byKind.has(kind)) {
          throw new Error(`Duplicate MCP runtime driver for ${kind}`);
        }
        this.byKind.set(kind, driver);
      }
    }
  }

  resolve(definition: McpRuntimeDefinition): McpRuntimeDriver {
    const driver = this.byKind.get(definition.kind);
    if (!driver) throw new Error(`No MCP runtime driver registered for ${definition.kind}`);
    return driver;
  }

  all(): McpRuntimeDriver[] {
    return [...new Set(this.byKind.values())];
  }
}
