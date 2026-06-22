import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';

mock.module('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    async initialize() {
      return 'mock-volume';
    }

    getVolumeConfig(containerPath = '/input', readOnly = true) {
      return { source: 'mock-volume', target: containerPath, readOnly };
    }

    async cleanup() {}
  },
}));

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('yara component', () => {
  beforeAll(async () => {
    await import('../yara');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes rules, target, and custom flags to the docker runner', async () => {
    const component = componentRegistry.get<any, any>('sentris.yara.run');
    if (!component) throw new Error('YARA component was not registered');

    const runSpy = vi
      .spyOn(sdk, 'runComponentWithRunner')
      .mockResolvedValue('audit /input/target.bin\n');

    await component.execute(
      {
        inputs: {
          target: 'audit test content',
          rules: 'rule audit { strings: $a = "audit" condition: $a }',
          customFlags: '-w',
        },
        params: {
          timeout: 45,
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'yara-cli' }),
    );

    const runnerConfig = runSpy.mock.calls[0]?.[0] as
      | { command?: string[]; timeoutSeconds?: number }
      | undefined;

    expect(runnerConfig?.timeoutSeconds).toBe(45);
    expect(runnerConfig?.command).toContain('-s');
    expect(runnerConfig?.command).toContain('-w');
    expect(runnerConfig?.command).toContain('/input/rules.yar');
    expect(runnerConfig?.command).toContain('/input/target.bin');
  });

  it('returns empty results when rules are blank', async () => {
    const component = componentRegistry.get<any, any>('sentris.yara.run');
    if (!component) throw new Error('YARA component was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    const result = await component.execute(
      {
        inputs: {
          target: 'audit test content',
          rules: '',
        },
        params: {},
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'yara-empty-rules' }),
    );

    expect(result).toMatchObject({ matches: [], results: [] });
    expect(runSpy).not.toHaveBeenCalled();
  });
});
