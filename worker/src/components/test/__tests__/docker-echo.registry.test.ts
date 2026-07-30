import { describe, expect, it } from 'bun:test';
import { createExecutionContext } from '@sentris/component-sdk';

import { componentRegistry } from '../../index';

describe('production component registry', () => {
  it('exposes the Docker echo fixture used by release smoke and benchmarks', () => {
    const component = componentRegistry.get('test.docker.echo');

    expect(component?.runner).toEqual({
      kind: 'docker',
      image: 'alpine:3.20',
      command: ['sh', '-c', 'cat'],
      timeoutSeconds: 10,
    });
  });

  it('routes execution through the Docker runner', async () => {
    const component = componentRegistry.get('test.docker.echo');
    const cancellation = new AbortController();
    cancellation.abort(new Error('release fixture cancelled before Docker start'));
    const context = createExecutionContext({
      runId: 'sentris-run-00000000-0000-4000-8000-000000000001',
      componentRef: 'docker',
      signal: cancellation.signal,
    });

    await expect(
      component!.execute(
        {
          inputs: { message: 'round-trip' },
          params: {},
        },
        context,
      ),
    ).rejects.toThrow('release fixture cancelled before Docker start');
  });
});
