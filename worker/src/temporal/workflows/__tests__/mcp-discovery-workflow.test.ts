import { beforeAll, beforeEach, describe, expect, mock, test, vi } from 'bun:test';
import type { McpCatalog, McpRuntimeKey } from '@sentris/shared';
import type { McpTool } from '../../types';

const discoverMcpToolsActivity = vi.fn();
const discoverMcpGroupToolsActivity = vi.fn();
const cacheDiscoveryResultActivity = vi.fn();
const discoverSavedMcpRuntimeActivity = vi.fn();
const previewSavedMcpRuntimeActivity = vi.fn();
const setHandler = vi.fn();
const registeredActivityOptions: unknown[] = [];

const activityImplementations = {
  discoverMcpToolsActivity,
  discoverMcpGroupToolsActivity,
  cacheDiscoveryResultActivity,
  discoverSavedMcpRuntimeActivity,
  previewSavedMcpRuntimeActivity,
};

const proxyActivities = vi.fn((options: unknown) => {
  registeredActivityOptions.push(options);
  return new Proxy(
    {},
    {
      get: (_target, property) =>
        activityImplementations[property as keyof typeof activityImplementations],
    },
  );
});

class MockApplicationFailure extends Error {
  nonRetryable = false;
}

mock.module('@temporalio/workflow', () => ({
  ApplicationFailure: MockApplicationFailure,
  defineQuery: vi.fn((name: string) => name),
  proxyActivities,
  setHandler,
  workflowInfo: vi.fn(() => ({ workflowId: 'mcp-discovery-workflow-1' })),
}));

const runtimeKey: McpRuntimeKey = {
  sourceId: 'mcp-server:server-1',
  transport: 'http',
  configFingerprint: 'a'.repeat(64),
  organizationId: 'organization-a',
  principalPartitionHash: 'b'.repeat(64),
  credentialReference: 'mcp-server:server-1',
  credentialGeneration: 7,
};

const catalog: McpCatalog = {
  protocolEra: 'modern',
  protocolVersion: '2026-07-28',
  capabilityFingerprint: 'c'.repeat(64),
  tools: [
    {
      canonicalName: 'mcp_server_1.search',
      displayName: 'Search',
      description: 'Search the upstream service',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
      source: {
        kind: 'mcp',
        sourceId: 'mcp-server:server-1',
        serverId: 'server-1',
        upstreamName: 'search',
        bindingFingerprint: 'd'.repeat(64),
      },
      effects: 'read-only',
      effectsSource: 'mcp-annotation',
      retryPolicy: 'reviewed-idempotent',
    },
  ],
  resources: [
    {
      sourceId: 'mcp-server:server-1',
      uri: 'sentris://reports/latest',
      name: 'Latest report',
      mimeType: 'application/json',
    },
  ],
  resourceTemplates: [
    {
      sourceId: 'mcp-server:server-1',
      uriTemplate: 'sentris://reports/{id}',
      name: 'Report',
      mimeType: 'application/json',
    },
  ],
  prompts: [
    {
      sourceId: 'mcp-server:server-1',
      name: 'summarize_report',
      arguments: [{ name: 'reportId', required: true }],
    },
  ],
};

const legacyProjection: McpTool[] = [
  {
    name: 'search',
    description: 'Search the upstream service',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
    },
  },
];

let mcpDiscoveryWorkflow: typeof import('../mcp-discovery-workflow').mcpDiscoveryWorkflow;
let mcpSavedServerPreviewWorkflow: typeof import('../mcp-discovery-workflow').mcpSavedServerPreviewWorkflow;

beforeAll(async () => {
  ({ mcpDiscoveryWorkflow, mcpSavedServerPreviewWorkflow } =
    await import('../mcp-discovery-workflow'));
});

beforeEach(() => {
  vi.clearAllMocks();
  discoverSavedMcpRuntimeActivity.mockResolvedValue({ catalog });
  discoverMcpToolsActivity.mockResolvedValue({ tools: legacyProjection });
  discoverMcpGroupToolsActivity.mockResolvedValue({ results: [] });
  cacheDiscoveryResultActivity.mockResolvedValue(undefined);
  previewSavedMcpRuntimeActivity.mockResolvedValue({
    kind: 'prompt',
    target: 'summarize_report',
    output: { messages: [{ role: 'user', content: { type: 'text', text: 'Summarize 42' } }] },
  });
});

describe('mcpDiscoveryWorkflow', () => {
  test('gives saved discovery enough activity time for the configured manager startup budget', () => {
    expect(registeredActivityOptions).toContainEqual({
      startToCloseTimeout: 30 * 60 * 1_000,
      scheduleToCloseTimeout: 60 * 60 * 1_000,
      heartbeatTimeout: '20 seconds',
      retry: {
        initialInterval: '30 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 5,
      },
    });
  });

  test('retains the full saved-server catalog while projecting tools for legacy consumers', async () => {
    const result = await mcpDiscoveryWorkflow({
      mode: 'saved-server',
      runtimeKey,
      cacheToken: 'cache-token-1',
    });

    expect(discoverSavedMcpRuntimeActivity).toHaveBeenCalledWith({ runtimeKey });
    expect(discoverMcpToolsActivity).not.toHaveBeenCalled();
    expect(cacheDiscoveryResultActivity).toHaveBeenCalledWith({
      cacheToken: 'cache-token-1',
      tools: legacyProjection,
      workflowId: 'mcp-discovery-workflow-1',
    });
    expect(result).toEqual({
      workflowId: 'mcp-discovery-workflow-1',
      status: 'completed',
      tools: legacyProjection,
      toolCount: 1,
      catalog,
    });

    const queryHandler = setHandler.mock.calls.find(
      ([definition]) => definition === 'getDiscoveryResult',
    )?.[1] as (() => unknown) | undefined;
    expect(queryHandler?.()).toEqual({
      status: 'completed',
      tools: legacyProjection,
      toolCount: 1,
      catalog,
    });
  });

  test('keeps the inline discovery mode on the legacy activity and result shape', async () => {
    const result = await mcpDiscoveryWorkflow({
      mode: 'inline-legacy',
      transport: 'http',
      name: 'Legacy server',
      endpoint: 'https://mcp.example.test/api',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(discoverMcpToolsActivity).toHaveBeenCalledWith({
      transport: 'http',
      endpoint: 'https://mcp.example.test/api',
      command: undefined,
      args: undefined,
      headers: { Authorization: 'Bearer test-token' },
      image: undefined,
    });
    expect(discoverSavedMcpRuntimeActivity).not.toHaveBeenCalled();
    expect(result).toEqual({
      workflowId: 'mcp-discovery-workflow-1',
      status: 'completed',
      tools: legacyProjection,
      toolCount: 1,
    });
    expect(result).not.toHaveProperty('catalog');
  });
});

describe('mcpSavedServerPreviewWorkflow', () => {
  test('forwards a secret-free prompt preview through the durable saved-runtime activity', async () => {
    const input = {
      runtimeKey,
      operation: {
        kind: 'prompt-get' as const,
        name: 'summarize_report',
        arguments: { reportId: '42' },
      },
    };

    await expect(mcpSavedServerPreviewWorkflow(input)).resolves.toEqual({
      kind: 'prompt',
      target: 'summarize_report',
      output: { messages: [{ role: 'user', content: { type: 'text', text: 'Summarize 42' } }] },
    });
    expect(previewSavedMcpRuntimeActivity).toHaveBeenCalledWith(input);
  });
});
