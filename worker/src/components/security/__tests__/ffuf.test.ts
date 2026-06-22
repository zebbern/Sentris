import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';

mock.module('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    async initialize() {
      return 'mock-volume';
    }

    getVolumeConfig(containerPath = '/inputs', readOnly = true) {
      return { source: 'mock-volume', target: containerPath, readOnly };
    }

    getVolumeName() {
      return 'mock-volume';
    }

    async cleanup() {}
  },
}));

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('ffuf component', () => {
  beforeAll(async () => {
    await import('../ffuf');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a pullable ffuf container image', () => {
    const component = componentRegistry.get<any, any>('sentris.ffuf.run');
    if (!component) throw new Error('ffuf component was not registered');
    const runner = component.runner as { kind?: string; image?: string };

    expect(runner.kind).toBe('docker');
    expect(runner.image).toBe('parrotsec/ffuf:latest');
  });

  it('honors the requested timeout for bounded live fuzzing runs', async () => {
    const component = componentRegistry.get<any, any>('sentris.ffuf.run');
    if (!component) throw new Error('ffuf component was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(
      {
        inputs: {
          target: 'https://example.com/FUZZ',
          wordlist: 'api/health',
        },
        params: {
          timeout: 90,
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'ffuf-timeout' }),
    );

    const runnerConfig = runSpy.mock.calls[0]?.[0] as { timeoutSeconds?: number } | undefined;

    expect(runnerConfig?.timeoutSeconds).toBe(90);
  });

  it('uses the supported ffuf silent flag', async () => {
    const component = componentRegistry.get<any, any>('sentris.ffuf.run');
    if (!component) throw new Error('ffuf component was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(
      {
        inputs: {
          target: 'https://example.com/FUZZ',
          wordlist: 'api/health',
        },
        params: {},
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'ffuf-silent-flag' }),
    );

    const command = (runSpy.mock.calls[0]?.[0] as { command?: string[] } | undefined)?.command;

    expect(command).toContain('-s');
    expect(command).not.toContain('-silent');
  });
});
