import { afterEach, beforeAll, describe, expect, it, mock, vi } from 'bun:test';
import { componentRegistry, createExecutionContext } from '@sentris/component-sdk';

const executeMcpGroupNode = vi.fn(async () => undefined);

mock.module('../../core/mcp-group-runtime', () => ({
  executeMcpGroupNode,
  McpGroupTemplateSchema: {
    parse: (value: unknown) => value,
  },
}));

describe('aws mcp group component', () => {
  beforeAll(async () => {
    executeMcpGroupNode.mockClear();
    await import('../aws-mcp-group');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    executeMcpGroupNode.mockClear();
  });

  it('registers the aws mcp group with expected servers', () => {
    const component = componentRegistry.get<any, any>('mcp.group.aws');
    expect(component).toBeDefined();
    expect(component!.toolProvider?.kind).toBe('mcp-group');
    expect(component!.parameters!.safeParse({}).success).toBe(true);
  });

  it('requires aws credentials before registering tools', async () => {
    const component = componentRegistry.get<any, any>('mcp.group.aws');
    if (!component) throw new Error('AWS MCP group was not registered');

    await expect(
      component.execute(
        {
          inputs: {},
          params: { enabledServers: ['aws-documentation'] },
        },
        createExecutionContext({ runId: 'test-run', componentRef: 'aws-mcp-missing-creds' }),
      ),
    ).rejects.toThrow(/credentials are required/i);
  });

  it('registers selected servers and returns tool metadata', async () => {
    const component = componentRegistry.get<any, any>('mcp.group.aws');
    if (!component) throw new Error('AWS MCP group was not registered');

    const result = (await component.execute(
      {
        inputs: {
          credentials: {
            accessKeyId: 'AKIA_TEST',
            secretAccessKey: 'secret',
            region: 'us-east-1',
          },
        },
        params: {
          enabledServers: ['aws-documentation', 'aws-iam'],
        },
      },
      createExecutionContext({ runId: 'test-run', componentRef: 'aws-mcp-enabled' }),
    )) as { tools: { id: string; group: string }[] };

    expect(executeMcpGroupNode).toHaveBeenCalledTimes(1);
    expect(result.tools).toEqual([
      expect.objectContaining({ id: 'aws-documentation', group: 'aws' }),
      expect.objectContaining({ id: 'aws-iam', group: 'aws' }),
    ]);
  });
});
