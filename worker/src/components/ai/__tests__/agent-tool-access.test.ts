import { describe, expect, it, vi } from 'bun:test';
import { ConfigurationError } from '@sentris/component-sdk';
import { prepareAgentGatewayAccess } from '../agent-tool-access';

const baseInput = {
  runId: 'run-tools',
  organizationId: 'org-tools',
  connectedToolNodeIds: ['tool-a'],
  ttlSeconds: 900,
} as const;

describe('prepareAgentGatewayAccess', () => {
  it('does not request a gateway token when no tool nodes are connected', async () => {
    const requestToken = vi.fn(async () => 'unexpected-token');

    const result = await prepareAgentGatewayAccess({
      ...baseInput,
      connectedToolNodeIds: [],
      requestToken,
    });

    expect(result.toolStatus).toEqual({
      requested: false,
      status: 'not-requested',
      connectedNodeCount: 0,
    });
    expect(requestToken).not.toHaveBeenCalled();
  });

  it('returns configured status after a gateway token is issued', async () => {
    const result = await prepareAgentGatewayAccess({
      ...baseInput,
      requestToken: async () => 'gateway-token',
    });

    expect(result.gatewayToken).toBe('gateway-token');
    expect(result.toolStatus).toEqual({
      requested: true,
      status: 'configured',
      connectedNodeCount: 1,
    });
  });

  it('fails required mode when the connected gateway cannot be configured', async () => {
    await expect(
      prepareAgentGatewayAccess({
        ...baseInput,
        requestToken: async () => {
          throw new Error('gateway unavailable');
        },
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('degrades best-effort mode when the connected gateway cannot be configured', async () => {
    const result = await prepareAgentGatewayAccess({
      ...baseInput,
      toolAvailability: 'best-effort',
      requestToken: async () => {
        throw new Error('gateway unavailable');
      },
    });

    expect(result.gatewayToken).toBe('');
    expect(result.toolStatus).toEqual({
      requested: true,
      status: 'degraded',
      connectedNodeCount: 1,
      message: 'gateway unavailable',
    });
  });

  it('closes a zero-tool discovery before failing required mode', async () => {
    const close = vi.fn(async () => {});
    await expect(
      prepareAgentGatewayAccess({
        ...baseInput,
        requestToken: async () => 'gateway-token',
        discoverTools: async () => ({ tools: {}, availableToolCount: 0, close }),
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes a zero-tool discovery before degrading best-effort mode', async () => {
    const close = vi.fn(async () => {});

    const result = await prepareAgentGatewayAccess({
      ...baseInput,
      toolAvailability: 'best-effort',
      requestToken: async () => 'gateway-token',
      discoverTools: async () => ({ tools: {}, availableToolCount: 0, close }),
    });

    expect(result.toolStatus).toEqual({
      requested: true,
      status: 'degraded',
      connectedNodeCount: 1,
      message: 'gateway discovery returned zero tools',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
