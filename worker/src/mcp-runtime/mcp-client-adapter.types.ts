import type {
  McpRuntimeKey,
  PromptDescriptor,
  ResourceDescriptor,
  ResourceTemplateDescriptor,
  ToolDescriptor,
} from '@sentris/shared';
import type {
  AuthProvider,
  Client,
  ConnectOptions,
  DiscoverResult,
  FetchLike,
  Implementation,
  InMemoryResponseCacheStore,
  ServerCapabilities,
} from '@modelcontextprotocol/client';

import type { McpClientAdapter } from './mcp-client-adapter';

export interface McpOperationContext {
  signal: AbortSignal;
  idleTimeoutMs: number;
  maxTotalTimeoutMs: number;
  progressReporter?: (progress: McpClientProgress) => void;
}

export interface McpClientProgress {
  progress: number;
  total?: number;
  message?: string;
}

/** Adapter-level sentinel; Task 7 supplies the durable operation identity. */
export interface InputRequiredUnsupportedSentinel {
  kind: 'input-required-unsupported';
  message: string;
  retryable: false;
}

export interface McpClientAdapterOptions {
  progressIntervalMs?: number;
  now?: () => number;
  closeCleanup?: () => void;
}

export interface McpConnectionMetadata {
  protocolEra: 'modern' | 'legacy';
  protocolVersion: string;
  discover?: DiscoverResult;
  serverInfo?: Implementation;
  serverCapabilities?: ServerCapabilities;
  instructions?: string;
}

export interface McpOwnedClient {
  runtimeKey: McpRuntimeKey;
  cachePartition: string;
  cacheStore: InMemoryResponseCacheStore;
  adapter: McpClientAdapter;
}

export interface McpDiscoverResult {
  metadata: McpConnectionMetadata;
  tools: ToolDescriptor[];
  resources: ResourceDescriptor[];
  resourceTemplates: ResourceTemplateDescriptor[];
  prompts: PromptDescriptor[];
}

export interface McpHttpConnectionInput {
  transport: 'http';
  endpoint: URL;
  requestInit?: RequestInit;
  authProvider?: AuthProvider;
  fetch?: FetchLike;
  runtimeKey: McpRuntimeKey;
  signal: AbortSignal;
  timeout: number;
}

export interface McpStdioConnectionInput {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  runtimeKey: McpRuntimeKey;
  signal: AbortSignal;
  timeout: number;
}

export type McpConnectionInput = McpHttpConnectionInput | McpStdioConnectionInput;

export interface McpSseCompatibilityConnector {
  connect(
    endpoint: URL,
    connectOptions: ConnectOptions,
    cachePartition: string,
    responseCacheStore: InMemoryResponseCacheStore,
    authProvider?: AuthProvider,
    requestInit?: RequestInit,
  ): Promise<Client>;
}

export interface McpClientFactoryOptions {
  priorTtlMs?: number;
  stdioProbeTimeoutMs?: number;
  now?: () => number;
  sseAdapter?: McpSseCompatibilityConnector;
}
