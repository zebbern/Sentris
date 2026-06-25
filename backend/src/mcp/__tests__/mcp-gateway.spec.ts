import { describe, it, expect, beforeEach, jest } from 'bun:test';
import {
  buildMcpGatewayCacheKey,
  McpGatewayService,
  parseMcpGatewayCacheKey,
} from '../mcp-gateway.service';
import { ToolRegistryService } from '../tool-registry.service';
import { NotFoundException } from '@nestjs/common';

async function invokeToolCall(
  server: unknown,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const requestHandlers = ((server as any).server as any)._requestHandlers as Map<
    string,
    (request: unknown, extra: unknown) => Promise<unknown>
  >;
  const callHandler = requestHandlers.get('tools/call');
  if (!callHandler) {
    throw new Error('tools/call handler not registered');
  }

  return callHandler(
    { method: 'tools/call', params: { name: toolName, arguments: args } },
    { signal: new AbortController().signal },
  );
}

describe('MCP gateway cache keys', () => {
  it('round-trips scoped node IDs with separators and escape characters', () => {
    const nodeIds = ['plain-node', 'node,with,commas', 'node\\with\\slashes'];

    const cacheKey = buildMcpGatewayCacheKey('run-1', nodeIds);

    expect(parseMcpGatewayCacheKey(cacheKey, 'run-1')).toEqual([...nodeIds].sort());
  });

  it('returns undefined for unscoped or unrelated cache keys', () => {
    expect(parseMcpGatewayCacheKey('run-1', 'run-1')).toBeUndefined();
    expect(parseMcpGatewayCacheKey('run-2:node-a', 'run-1')).toBeUndefined();
  });
});

describe('McpGatewayService Unit Tests', () => {
  let service: McpGatewayService;
  let toolRegistry: ToolRegistryService;
  let temporalService: any;
  let workflowRunRepository: any;
  let traceRepository: any;
  let mcpServersRepository: any;

  beforeEach(() => {
    toolRegistry = {
      getServerTools: jest.fn(),
      getToolsForRun: jest.fn().mockResolvedValue([]),
      getRunTools: jest.fn(),
      getToolCredentials: jest.fn(),
    } as any;
    temporalService = {} as any;
    workflowRunRepository = {
      findByRunId: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
    } as any;
    traceRepository = {
      createEvent: jest.fn(),
    } as any;
    mcpServersRepository = {
      findOne: jest.fn(),
    } as any;

    service = new McpGatewayService(
      toolRegistry,
      temporalService,
      workflowRunRepository,
      traceRepository,
      mcpServersRepository,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getServerForRun', () => {
    it('returns a proxy server with correct tool naming', async () => {
      (toolRegistry.getToolsForRun as any).mockResolvedValue([
        {
          nodeId: 'aws-node',
          toolName: 'AWS',
          type: 'mcp-server',
          endpoint: 'http://localhost:8080',
          status: 'ready',
        },
      ]);

      (toolRegistry.getServerTools as any).mockResolvedValue([
        { name: 'list_buckets', description: 'S3 list', inputSchema: { type: 'object' } },
      ]);

      const server = await service.getServerForRun('run-1', 'org-1', undefined, ['aws-node']);

      expect(server).toBeDefined();
      expect(toolRegistry.getToolsForRun).toHaveBeenCalledWith('run-1', ['aws-node']);
      expect(toolRegistry.getServerTools).toHaveBeenCalledWith('run-1', 'aws-node');
    });

    it('filters tools by allowedNodeIds (hierarchical)', async () => {
      (toolRegistry.getToolsForRun as any).mockResolvedValue([
        {
          nodeId: 'parent/child1',
          toolName: 'Child 1',
          type: 'mcp-server',
          endpoint: 'http://c1',
          status: 'ready',
        },
        {
          nodeId: 'parent/child2',
          toolName: 'Child 2',
          type: 'mcp-server',
          endpoint: 'http://c2',
          status: 'ready',
        },
      ]);

      (toolRegistry.getServerTools as any).mockResolvedValue([
        { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' } },
      ]);

      const server = await service.getServerForRun('run-1', 'org-1', undefined, ['parent']);
      expect(server).toBeDefined();
      expect(toolRegistry.getToolsForRun).toHaveBeenCalledWith('run-1', ['parent']);
    });

    it('forwards MCP client arguments to external MCP tools', async () => {
      const proxiedCall = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });
      (service as any).proxyCallToExternal = proxiedCall;
      traceRepository.getLastSequence = jest.fn().mockResolvedValue(0);
      traceRepository.append = jest.fn().mockResolvedValue(undefined);

      (toolRegistry.getToolsForRun as any).mockResolvedValue([
        {
          nodeId: 'custom_mcp_tools/fetch-server',
          toolName: 'Fetch (Reference)',
          type: 'mcp-server',
          endpoint: 'http://localhost:54424/mcp',
          status: 'ready',
        },
      ]);

      (toolRegistry.getServerTools as any).mockResolvedValue([
        {
          name: 'fetch',
          description: 'Fetch URL',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url'],
          },
        },
      ]);

      const server = await service.getServerForRun('run-1', 'org-1', undefined, [
        'custom_mcp_tools',
      ]);

      await invokeToolCall(server, 'Fetch_Reference__fetch', {
        url: 'https://example.com',
        max_length: 1200,
      });

      expect(proxiedCall).toHaveBeenCalledWith(
        'run-1',
        'run-1:custom_mcp_tools',
        expect.objectContaining({ nodeId: 'custom_mcp_tools/fetch-server' }),
        'fetch',
        { url: 'https://example.com', max_length: 1200 },
      );
    });

    it('throws NotFoundException if run not found', async () => {
      (workflowRunRepository.findByRunId as any).mockResolvedValue(null);

      await expect(service.getServerForRun('non-existent', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cleanupRun', () => {
    it('cleans scoped cache entries without closing external clients for other runs', async () => {
      (workflowRunRepository.findByRunId as any).mockResolvedValue({ organizationId: 'org-1' });
      (toolRegistry.getToolsForRun as any).mockResolvedValue([]);

      const scopedServer = await service.getServerForRun('run-1', 'org-1', undefined, ['node-a']);
      await service.getServerForRun('run-2', 'org-1');

      const scopedClose = jest.fn().mockResolvedValue(undefined);
      (scopedServer as any).close = scopedClose;

      const gateway = service as any;
      const scopedKey = 'run-1:node-a';
      const run1ClientClose = jest.fn().mockResolvedValue(undefined);
      const run2ClientClose = jest.fn().mockResolvedValue(undefined);

      gateway.registeredToolNames.get(scopedKey).add('Scoped__tool');
      gateway.externalToolSchemas.set('Scoped__tool', { type: 'object' });
      gateway.externalClients.set('run-1\u0000http://localhost:4011/mcp', {
        close: run1ClientClose,
      });
      gateway.externalClients.set('run-2\u0000http://localhost:4012/mcp', {
        close: run2ClientClose,
      });

      await service.cleanupRun('run-1');

      expect(scopedClose).toHaveBeenCalledTimes(1);
      expect(gateway.servers.has(scopedKey)).toBe(false);
      expect(gateway.registeredToolNames.has(scopedKey)).toBe(false);
      expect(gateway.externalToolSchemas.has('Scoped__tool')).toBe(false);
      expect(run1ClientClose).toHaveBeenCalledTimes(1);
      expect(run2ClientClose).not.toHaveBeenCalled();
      expect(gateway.externalClients.has('run-2\u0000http://localhost:4012/mcp')).toBe(true);
    });
  });
});
