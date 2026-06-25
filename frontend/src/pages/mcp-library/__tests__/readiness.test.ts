import { describe, expect, it } from 'bun:test';

import { getMcpAgentReadiness } from '../utils';

describe('getMcpAgentReadiness', () => {
  it('marks disabled servers as disabled', () => {
    expect(
      getMcpAgentReadiness({
        enabled: false,
        healthStatus: 'healthy',
        toolCounts: { enabled: 1, total: 1 },
      }),
    ).toEqual({
      status: 'disabled',
      label: 'Disabled',
      tone: 'muted',
    });
  });

  it('marks enabled healthy servers with enabled tools as ready', () => {
    expect(
      getMcpAgentReadiness({
        enabled: true,
        healthStatus: 'healthy',
        toolCounts: { enabled: 2, total: 3 },
      }),
    ).toEqual({
      status: 'ready',
      label: 'Ready',
      tone: 'success',
    });
  });

  it('marks enabled unchecked servers as needing a test', () => {
    expect(
      getMcpAgentReadiness({
        enabled: true,
        healthStatus: null,
        toolCounts: { enabled: 0, total: 0 },
      }),
    ).toEqual({
      status: 'needs-test',
      label: 'Needs test',
      tone: 'warning',
    });
  });

  it('marks enabled unhealthy servers as unhealthy', () => {
    expect(
      getMcpAgentReadiness({
        enabled: true,
        healthStatus: 'unhealthy',
        toolCounts: { enabled: 0, total: 0 },
      }),
    ).toEqual({
      status: 'unhealthy',
      label: 'Unhealthy',
      tone: 'destructive',
    });
  });

  it('marks healthy servers without enabled tools as no tools', () => {
    expect(
      getMcpAgentReadiness({
        enabled: true,
        healthStatus: 'healthy',
        toolCounts: { enabled: 0, total: 2 },
      }),
    ).toEqual({
      status: 'no-tools',
      label: 'No tools',
      tone: 'warning',
    });
  });
});
