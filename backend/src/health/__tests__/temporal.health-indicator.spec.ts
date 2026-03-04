import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { TemporalHealthIndicator } from '../indicators/temporal.health-indicator';

const mockClose = vi.fn().mockResolvedValue(undefined);
const mockDescribeNamespace = vi.fn().mockResolvedValue({});
const mockConnect = vi.fn().mockResolvedValue({
  workflowService: { describeNamespace: mockDescribeNamespace },
  close: mockClose,
});

vi.mock('@temporalio/client', () => ({
  Connection: { connect: (...args: any[]) => mockConnect(...args) },
}));

function createMockConfigService() {
  return {
    get: vi.fn((key: string) => {
      if (key === 'temporalTask') {
        return { address: 'localhost:7233', namespace: 'default' };
      }
      return undefined;
    }),
  };
}

describe('TemporalHealthIndicator', () => {
  let indicator: TemporalHealthIndicator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({
      workflowService: { describeNamespace: mockDescribeNamespace },
      close: mockClose,
    });
    mockDescribeNamespace.mockResolvedValue({});
    const configService = createMockConfigService();
    indicator = new TemporalHealthIndicator(configService as any);
  });

  it('returns healthy when describeNamespace succeeds', async () => {
    const result = await indicator.isHealthy();
    expect(result.temporal.status).toBe('up');
    expect(mockConnect).toHaveBeenCalledWith({ address: 'localhost:7233' });
    expect(mockDescribeNamespace).toHaveBeenCalledWith({ namespace: 'default' });
    expect(mockClose).toHaveBeenCalled();
  });

  it('throws HealthCheckError when connection fails', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'));

    await expect(indicator.isHealthy()).rejects.toThrow();
  });

  it('throws HealthCheckError when describeNamespace fails', async () => {
    mockDescribeNamespace.mockRejectedValue(new Error('namespace not found'));

    await expect(indicator.isHealthy()).rejects.toThrow();
  });

  it('closes connection even on error', async () => {
    mockDescribeNamespace.mockRejectedValue(new Error('ns error'));

    try {
      await indicator.isHealthy();
    } catch {
      // expected
    }
    expect(mockClose).toHaveBeenCalled();
  });

  it('uses the provided key name', async () => {
    const result = await indicator.isHealthy('workflow-engine');
    expect(result['workflow-engine']).toBeDefined();
    expect(result['workflow-engine'].status).toBe('up');
  });
});
