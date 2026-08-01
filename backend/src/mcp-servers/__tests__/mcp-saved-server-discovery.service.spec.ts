import { describe, expect, it, vi } from 'bun:test';
import type { McpCatalog, McpRuntimeKey } from '@sentris/shared';

import { McpSavedServerDiscoveryService } from '../mcp-saved-server-discovery.service';

const runtimeKey: McpRuntimeKey = {
  sourceId: 'server-1',
  transport: 'http',
  configFingerprint: 'a'.repeat(64),
  organizationId: 'org-1',
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
      canonicalName: 'lookup',
      displayName: 'Lookup',
      inputSchema: { type: 'object' },
      source: {
        kind: 'mcp',
        sourceId: 'server-1',
        upstreamName: 'lookup',
        bindingFingerprint: 'a'.repeat(64),
      },
      effects: 'unknown',
      effectsSource: 'unknown',
      retryPolicy: 'pre-dispatch-only',
    },
  ],
  resources: [{ sourceId: 'server-1', uri: 'sentris://latest', name: 'Latest' }],
  resourceTemplates: [
    {
      sourceId: 'server-1',
      uriTemplate: 'sentris://event/{id}',
      name: 'Event',
    },
  ],
  prompts: [
    {
      sourceId: 'server-1',
      name: 'investigate',
      arguments: [{ name: 'id', required: true }],
    },
  ],
};

describe('McpSavedServerDiscoveryService', () => {
  it('returns the complete catalog through a secret-free saved-server workflow input', async () => {
    const temporal = {
      startWorkflow: vi.fn(async (_options: unknown) => ({
        workflowId: 'discovery-1',
        runId: 'temporal-run-1',
        taskQueue: 'sentris-worker-0',
      })),
      getWorkflowResult: vi.fn(async () => ({ status: 'completed', catalog })),
      getDefaultTaskQueue: vi.fn(() => 'sentris-worker-0'),
      cancelWorkflow: vi.fn(async () => undefined),
    };
    const service = new McpSavedServerDiscoveryService(temporal as never);

    await expect(service.discover(runtimeKey)).resolves.toEqual(catalog);
    expect(temporal.startWorkflow).toHaveBeenCalledWith({
      workflowType: 'mcpDiscoveryWorkflow',
      taskQueue: 'sentris-worker-0',
      args: [{ mode: 'saved-server', runtimeKey }],
    });
    expect(temporal.getWorkflowResult).toHaveBeenCalledWith({
      workflowId: 'discovery-1',
      runId: 'temporal-run-1',
    });
    const serializedInput = JSON.stringify(temporal.startWorkflow.mock.calls[0]?.[0]);
    expect(serializedInput).not.toContain('Authorization');
    expect(serializedInput).not.toContain('Bearer');
    expect(serializedInput).not.toContain('endpoint');
    expect(temporal.cancelWorkflow).not.toHaveBeenCalled();
  });

  it('rejects a completed legacy tool-only result instead of inventing empty families', async () => {
    const temporal = {
      startWorkflow: vi.fn(async (_options: unknown) => ({
        workflowId: 'discovery-1',
        runId: 'temporal-run-1',
        taskQueue: 'sentris-worker-0',
      })),
      getWorkflowResult: vi.fn(async () => ({
        status: 'completed',
        tools: [{ name: 'legacy' }],
      })),
      getDefaultTaskQueue: vi.fn(() => 'sentris-worker-0'),
      cancelWorkflow: vi.fn(async () => undefined),
    };
    const service = new McpSavedServerDiscoveryService(temporal as never);

    await expect(service.discover(runtimeKey)).rejects.toThrow();
    expect(temporal.cancelWorkflow).not.toHaveBeenCalled();
  });

  it('cancels the exact Temporal run on timeout while preserving the timeout error', async () => {
    let triggerTimeout: (() => void) | undefined;
    const fakeTimer = { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    setTimeoutSpy.mockImplementation(((callback: () => void) => {
      triggerTimeout = callback;
      return fakeTimer;
    }) as never);
    clearTimeoutSpy.mockImplementation((() => undefined) as never);

    const temporal = {
      startWorkflow: vi.fn(async (_options: unknown) => ({
        workflowId: 'discovery-1',
        runId: 'temporal-run-1',
        taskQueue: 'sentris-worker-0',
      })),
      getWorkflowResult: vi.fn(() => new Promise(() => undefined)),
      getDefaultTaskQueue: vi.fn(() => 'sentris-worker-0'),
      cancelWorkflow: vi.fn(async () => {
        throw new Error('Temporal cancellation unavailable');
      }),
    };
    const service = new McpSavedServerDiscoveryService(temporal as never);

    try {
      const discovery = service.discover(runtimeKey);
      await Promise.resolve();
      await Promise.resolve();
      expect(triggerTimeout).toBeDefined();
      triggerTimeout!();

      await expect(discovery).rejects.toThrow(
        'MCP saved-server discovery timed out after 150 seconds',
      );
      expect(temporal.cancelWorkflow).toHaveBeenCalledWith({
        workflowId: 'discovery-1',
        runId: 'temporal-run-1',
      });
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });
});
