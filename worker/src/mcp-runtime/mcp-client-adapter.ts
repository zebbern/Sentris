import {
  isInputRequiredResult,
  type Client,
  type ContentBlock,
  type PriorDiscovery,
  type RequestOptions,
  type Tool,
} from '@modelcontextprotocol/client';
import {
  PromptDescriptor,
  PromptDescriptorSchema,
  ResourceDescriptor,
  ResourceDescriptorSchema,
  ResourceTemplateDescriptor,
  ResourceTemplateDescriptorSchema,
  ToolDescriptor,
  ToolDescriptorSchema,
} from '@sentris/shared';

import type {
  McpClientAdapterOptions,
  McpClientProgress,
  McpConnectionMetadata,
  McpDiscoverResult,
  InputRequiredUnsupportedSentinel,
  McpOperationContext,
} from './mcp-client-adapter.types';

interface ResultWithMeta {
  content?: ContentBlock[];
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
}
export interface NormalizedMcpResult {
  content?: unknown[];
  contents?: unknown[];
  messages?: unknown[];
  structuredContent?: unknown;
  meta?: Record<string, unknown>;
}

export class InputRequiredUnsupportedError
  extends Error
  implements InputRequiredUnsupportedSentinel
{
  readonly kind = 'input-required-unsupported' as const;
  readonly retryable = false as const;

  constructor(message: string) {
    super(message);
  }
}

export class McpClientAdapter {
  constructor(
    private readonly client: Client,
    private readonly options: McpClientAdapterOptions = {},
  ) {}

  async connect(
    transport: Parameters<Client['connect']>[0],
    context: McpOperationContext,
    prior?: PriorDiscovery,
  ): Promise<McpConnectionMetadata> {
    await this.client.connect(transport, { ...this.requestOptions(context), prior });
    return this.connectionMetadata();
  }

  async discover(
    sourceId: string,
    bindingFingerprint: string,
    context: McpOperationContext,
  ): Promise<McpDiscoverResult> {
    const metadata = await this.metadata();
    const capabilities = metadata.discover?.capabilities ?? this.client.getServerCapabilities();
    const [tools, resources, resourceTemplates, prompts] = await Promise.all([
      advertised(capabilities, 'tools')
        ? this.client.listTools(undefined, {
            ...this.requestOptions(context),
            cacheMode: 'refresh',
          })
        : Promise.resolve({ tools: [] }),
      advertised(capabilities, 'resources')
        ? this.client.listResources(undefined, {
            ...this.requestOptions(context),
            cacheMode: 'refresh',
          })
        : Promise.resolve({ resources: [] }),
      advertised(capabilities, 'resources')
        ? this.client.listResourceTemplates(undefined, {
            ...this.requestOptions(context),
            cacheMode: 'refresh',
          })
        : Promise.resolve({ resourceTemplates: [] }),
      advertised(capabilities, 'prompts')
        ? this.client.listPrompts(undefined, {
            ...this.requestOptions(context),
            cacheMode: 'refresh',
          })
        : Promise.resolve({ prompts: [] }),
    ]);
    return {
      metadata,
      tools: (tools.tools ?? []).map((tool) =>
        ToolDescriptorSchema.parse({
          canonicalName: tool.name,
          displayName: tool.title ?? tool.name,
          description: tool.description,
          inputSchema: recordOrEmpty(tool.inputSchema),
          ...(tool.outputSchema === undefined
            ? {}
            : { outputSchema: recordOrEmpty(tool.outputSchema) }),
          source: { kind: 'mcp', sourceId, upstreamName: tool.name, bindingFingerprint },
          ...(tool.title === undefined ? {} : { title: tool.title }),
          ...(tool.icons === undefined ? {} : { icons: tool.icons }),
          ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
          ...(tool._meta === undefined ? {} : { meta: tool._meta }),
          effects: 'unknown',
          effectsSource: 'unknown',
          retryPolicy: 'pre-dispatch-only',
        }),
      ),
      resources: (resources.resources ?? []).map((resource) =>
        ResourceDescriptorSchema.parse({ ...renameMeta(resource), sourceId }),
      ),
      resourceTemplates: (resourceTemplates.resourceTemplates ?? []).map((template) =>
        ResourceTemplateDescriptorSchema.parse({ ...renameMeta(template), sourceId }),
      ),
      prompts: (prompts.prompts ?? []).map((prompt) =>
        PromptDescriptorSchema.parse({
          ...renameMeta(prompt),
          sourceId,
          arguments: prompt.arguments ?? [],
        }),
      ),
    };
  }

  async callTool(
    toolDefinition: ToolDescriptor,
    args: Record<string, unknown>,
    context: McpOperationContext,
  ): Promise<NormalizedMcpResult> {
    const requestOptions = this.requestOptions(context);
    return this.operation(() =>
      this.client.callTool(
        {
          name:
            toolDefinition.source.kind === 'mcp'
              ? toolDefinition.source.upstreamName
              : toolDefinition.canonicalName,
          arguments: args,
        },
        {
          ...requestOptions,
          toolDefinition: toSdkToolDefinition(toolDefinition),
          allowInputRequired: true,
        },
      ),
    );
  }

  async readResource(uri: string, context: McpOperationContext): Promise<NormalizedMcpResult> {
    const requestOptions = this.requestOptions(context);
    return this.operation(() =>
      this.client.readResource(
        { uri },
        { ...requestOptions, cacheMode: 'refresh', allowInputRequired: true },
      ),
    );
  }

  async getPrompt(
    name: string,
    args: Record<string, string>,
    context: McpOperationContext,
  ): Promise<NormalizedMcpResult> {
    const requestOptions = this.requestOptions(context);
    return this.operation(() =>
      this.client.getPrompt(
        { name, arguments: args },
        { ...requestOptions, allowInputRequired: true },
      ),
    );
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      this.options.closeCleanup?.();
    }
  }

  normalizeResult(result: ResultWithMeta): NormalizedMcpResult {
    return {
      ...(result.content ? { content: result.content.map((content) => renameMeta(content)) } : {}),
      ...('contents' in result && Array.isArray(result.contents)
        ? { contents: result.contents.map((content) => renameMeta(content)) }
        : {}),
      ...('messages' in result && Array.isArray(result.messages)
        ? { messages: result.messages.map((message) => renameMeta(message)) }
        : {}),
      ...(result.structuredContent === undefined
        ? {}
        : { structuredContent: result.structuredContent }),
      ...(result._meta ? { meta: result._meta } : {}),
    };
  }

  private reportProgressWithState(
    progress: McpClientProgress,
    state: { value: number; at: number },
    update: (state: { value: number; at: number }) => void,
    context: McpOperationContext,
  ): void {
    if (
      !Number.isFinite(progress.progress) ||
      (progress.total !== undefined && (!Number.isFinite(progress.total) || progress.total <= 0))
    )
      return;
    if (progress.progress < state.value) return;
    const now = this.options.now?.() ?? Date.now();
    if (now - state.at < (this.options.progressIntervalMs ?? 250)) return;
    update({ value: progress.progress, at: now });
    context.progressReporter?.(progress);
  }

  private async metadata(): Promise<McpConnectionMetadata> {
    return this.connectionMetadata();
  }

  private connectionMetadata(): McpConnectionMetadata {
    const era = this.client.getProtocolEra();
    const version = this.client.getNegotiatedProtocolVersion();
    if (!era || !version) throw new Error('MCP client is not connected');
    return {
      protocolEra: era,
      protocolVersion: version,
      ...(this.client.getDiscoverResult() === undefined
        ? {}
        : { discover: this.client.getDiscoverResult() }),
      ...(this.client.getServerVersion() === undefined
        ? {}
        : { serverInfo: this.client.getServerVersion() }),
      ...(this.client.getServerCapabilities() === undefined
        ? {}
        : { serverCapabilities: this.client.getServerCapabilities() }),
      ...(this.client.getInstructions() === undefined
        ? {}
        : { instructions: this.client.getInstructions() }),
    };
  }

  private requestOptions(context: McpOperationContext): RequestOptions {
    if (
      !Number.isFinite(context.idleTimeoutMs) ||
      context.idleTimeoutMs <= 0 ||
      !Number.isFinite(context.maxTotalTimeoutMs) ||
      context.maxTotalTimeoutMs <= 0
    ) {
      throw new Error('MCP operation requires finite positive idle and total timeouts');
    }
    const progressState = { value: -Infinity, at: -Infinity };
    return {
      signal: context.signal,
      timeout: context.idleTimeoutMs,
      resetTimeoutOnProgress: true,
      maxTotalTimeout: context.maxTotalTimeoutMs,
      onprogress: (progress) =>
        this.reportProgressWithState(
          progress,
          progressState,
          (next) => {
            progressState.value = next.value;
            progressState.at = next.at;
          },
          context,
        ),
    } as RequestOptions;
  }

  private async operation<T extends ResultWithMeta>(
    operation: () => Promise<T>,
  ): Promise<NormalizedMcpResult> {
    const result = await operation();
    if (isInputRequiredResult(result)) {
      throw new InputRequiredUnsupportedError('MCP server requires interactive input');
    }
    return this.normalizeResult(result);
  }
}

function renameMeta<T extends Record<string, unknown>>(value: T): T {
  return normalizeMetadata(value) as T;
}

function normalizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeMetadata);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    normalized[key === '_meta' ? 'meta' : key] = normalizeMetadata(child);
  }
  return normalized;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('MCP server returned an invalid JSON schema object');
  }
  return value as Record<string, unknown>;
}

function advertised(capabilities: unknown, family: 'tools' | 'resources' | 'prompts'): boolean {
  if (capabilities === undefined) return true;
  return typeof capabilities === 'object' && capabilities !== null && family in capabilities;
}

function toSdkToolDefinition(tool: ToolDescriptor): Tool {
  if (!isSdkInputSchema(tool.inputSchema)) {
    throw new Error(`MCP tool '${tool.canonicalName}' has an unsupported input schema`);
  }
  return {
    name: tool.source.kind === 'mcp' ? tool.source.upstreamName : tool.canonicalName,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    ...(tool.icons === undefined ? {} : { icons: tool.icons }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
    ...(tool.meta === undefined ? {} : { _meta: tool.meta }),
  };
}

function isSdkInputSchema(value: unknown): value is Tool['inputSchema'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'type' in value &&
    value.type === 'object'
  );
}
