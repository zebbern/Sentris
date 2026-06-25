import { describe, expect, it } from 'bun:test';

import definition from '../conditional-router';

interface ConditionalRouterResult {
  matched: unknown;
  unmatched: unknown;
  activeOutputPorts: string[];
}

describe('conditional-router', () => {
  it('activates only the matched output port when condition passes', async () => {
    const result = (await definition.execute(
      {
        inputs: { value: { verdict: 'promote', confidence: 'high' } },
        params: { conditionType: 'equals', compareValue: 'promote', jsonPath: 'verdict' },
      },
      {
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        emitProgress: () => undefined,
      } as never,
    )) as ConditionalRouterResult;

    expect(result.activeOutputPorts).toEqual(['matched']);
    expect(result.matched).toEqual({ verdict: 'promote', confidence: 'high' });
    expect(result.unmatched).toBeNull();
  });

  it('activates only the unmatched output port when condition fails', async () => {
    const result = (await definition.execute(
      {
        inputs: { value: { verdict: 'reject', confidence: 'medium' } },
        params: { conditionType: 'equals', compareValue: 'promote', jsonPath: 'verdict' },
      },
      {
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        emitProgress: () => undefined,
      } as never,
    )) as ConditionalRouterResult;

    expect(result.activeOutputPorts).toEqual(['unmatched']);
    expect(result.matched).toBeNull();
    expect(result.unmatched).toEqual({ verdict: 'reject', confidence: 'medium' });
  });
});
