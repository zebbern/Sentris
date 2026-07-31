import { describe, expect, it, jest } from 'bun:test';

import { McpLegacyOutboundCompatibilityService } from '../mcp-legacy-outbound-compatibility.service';
import type { RegisteredTool, ToolRegistryService } from '../tool-registry.service';

describe('McpLegacyOutboundCompatibilityService', () => {
  it('coalesces concurrent connections and preserves discovered MCP metadata', async () => {
    const service = createService();
    let resolveClient!: (client: ReturnType<typeof fakeClient>) => void;
    const connection = new Promise<ReturnType<typeof fakeClient>>((resolve) => {
      resolveClient = resolve;
    });
    const connect = jest
      .spyOn(
        service as unknown as { connectLegacyOutboundClient: () => Promise<unknown> },
        'connectLegacyOutboundClient',
      )
      .mockReturnValue(connection);
    const client = fakeClient({
      tools: [
        {
          name: 'lookup',
          title: 'Lookup',
          description: 'Look up records',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          outputSchema: { type: 'object', properties: { count: { type: 'integer' } } },
          icons: [{ src: 'https://example.test/icon.svg', mimeType: 'image/svg+xml' }],
          annotations: { readOnlyHint: true },
          _meta: { 'x-upstream': true },
        },
      ],
    });

    const first = service.discoverTools('run-1', source());
    const second = service.discoverTools('run-1', source());
    resolveClient(client);

    await expect(first).resolves.toEqual([
      {
        name: 'lookup',
        title: 'Lookup',
        description: 'Look up records',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { count: { type: 'integer' } } },
        icons: [{ src: 'https://example.test/icon.svg', mimeType: 'image/svg+xml' }],
        annotations: { readOnlyHint: true },
        _meta: { 'x-upstream': true },
      },
    ]);
    await expect(second).resolves.toEqual(await first);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.listTools).toHaveBeenCalledTimes(2);
  });

  it('resolves registry headers and converts v1 call results at the adapter boundary', async () => {
    const getToolCredentials = jest.fn().mockResolvedValue({ 'x-sentris-token': 'secret-token' });
    const service = createService(getToolCredentials);
    const client = fakeClient({
      result: {
        content: [{ type: 'text', text: 'result' }],
        structuredContent: { count: 1 },
        isError: false,
        _meta: { requestId: 'upstream-1' },
      },
    });
    const connect = jest
      .spyOn(
        service as unknown as { connectLegacyOutboundClient: () => Promise<unknown> },
        'connectLegacyOutboundClient',
      )
      .mockResolvedValue(client);

    await expect(
      service.callTool('run-1', source(), 'lookup', { query: 'critical' }),
    ).resolves.toEqual({
      content: [{ type: 'text', text: 'result' }],
      structuredContent: { count: 1 },
      isError: false,
      _meta: { requestId: 'upstream-1' },
    });
    expect(connect).toHaveBeenCalledWith('https://mcp.example.test/mcp', {
      'x-sentris-token': 'secret-token',
    });
    expect(client.callTool).toHaveBeenCalledWith({
      name: 'lookup',
      arguments: { query: 'critical' },
    });
  });

  it('cleans only the requested run pool', async () => {
    const service = createService();
    const runOneClient = fakeClient();
    const runTwoClient = fakeClient();
    const connect = jest
      .spyOn(
        service as unknown as { connectLegacyOutboundClient: () => Promise<unknown> },
        'connectLegacyOutboundClient',
      )
      .mockResolvedValueOnce(runOneClient)
      .mockResolvedValueOnce(runTwoClient);

    await service.discoverTools('run-1', source());
    await service.discoverTools('run-2', source());
    await service.cleanupRun('run-1');
    await service.discoverTools('run-2', source());

    expect(connect).toHaveBeenCalledTimes(2);
    expect(runOneClient.close).toHaveBeenCalledTimes(1);
    expect(runTwoClient.close).not.toHaveBeenCalled();
    await service.cleanupRun('run-2');
    expect(runTwoClient.close).toHaveBeenCalledTimes(1);
  });

  it('does not evict a replacement when an old client operation fails late', async () => {
    const service = createService();
    let failFirst!: () => void;
    let failLate!: () => void;
    let markBothStarted!: () => void;
    let markReplacementUsed!: () => void;
    const firstFailure = new Promise<never>((_, reject) => {
      failFirst = () => reject(new Error('first failure'));
    });
    const lateFailure = new Promise<never>((_, reject) => {
      failLate = () => reject(new Error('late failure'));
    });
    const bothStarted = new Promise<void>((resolve) => {
      markBothStarted = resolve;
    });
    const replacementUsed = new Promise<void>((resolve) => {
      markReplacementUsed = resolve;
    });
    const oldClient = fakeClient();
    oldClient.callTool
      .mockImplementationOnce(() => firstFailure)
      .mockImplementationOnce(() => {
        markBothStarted();
        return lateFailure;
      });
    const replacement = fakeClient();
    replacement.callTool.mockImplementation(() => {
      markReplacementUsed();
      return Promise.resolve({ content: [{ type: 'text', text: 'replacement' }] });
    });
    const unexpected = fakeClient();
    const connect = jest
      .spyOn(
        service as unknown as { connectLegacyOutboundClient: () => Promise<unknown> },
        'connectLegacyOutboundClient',
      )
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValueOnce(replacement)
      .mockResolvedValue(unexpected);

    const first = service.callTool('run-1', source(), 'lookup', { query: 'first' });
    const late = service.callTool('run-1', source(), 'lookup', { query: 'late' });
    await bothStarted;
    failFirst();
    await replacementUsed;
    failLate();
    await Promise.all([first, late]);
    await service.callTool('run-1', source(), 'lookup', { query: 'after' });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(oldClient.close).toHaveBeenCalledTimes(1);
    expect(replacement.callTool).toHaveBeenCalledTimes(3);
    expect(replacement.close).not.toHaveBeenCalled();
    expect(unexpected.callTool).not.toHaveBeenCalled();
  });
});

function createService(getToolCredentials = jest.fn().mockResolvedValue(null)) {
  return new McpLegacyOutboundCompatibilityService({
    getToolCredentials,
  } as unknown as ToolRegistryService);
}

function source(): RegisteredTool {
  return {
    nodeId: 'external-node',
    toolName: 'External',
    type: 'local-mcp',
    status: 'ready',
    description: 'External server',
    inputSchema: { type: 'object' },
    endpoint: 'https://mcp.example.test/mcp',
    registeredAt: '2026-07-31T10:00:00.000Z',
  };
}

function fakeClient(input: { tools?: unknown[]; result?: unknown } = {}) {
  return {
    listTools: jest.fn().mockResolvedValue({ tools: input.tools ?? [] }),
    callTool: jest
      .fn()
      .mockResolvedValue(input.result ?? { content: [{ type: 'text', text: 'ok' }] }),
    close: jest.fn().mockResolvedValue(undefined),
  };
}
