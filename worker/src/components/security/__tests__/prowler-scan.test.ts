import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';

mock.module('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const command = args.join(' ');
    const stdoutData = command.includes('ls -1 /data') ? 'sentris.0001.json\n' : '';

    return {
      stdout: {
        on: (event: string, callback: (chunk: Buffer) => void) => {
          if (event === 'data' && stdoutData) {
            callback(Buffer.from(stdoutData));
          }
        },
      },
      stderr: { on: () => undefined },
      on: (event: string, callback: (code: number) => void) => {
        if (event === 'close') {
          callback(0);
        }
      },
    };
  },
}));

mock.module('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    async initialize() {
      return 'mock-volume';
    }

    getVolumeConfig(containerPath = '/output', readOnly = false) {
      return { source: 'mock-volume', target: containerPath, readOnly };
    }

    getVolumeName() {
      return 'mock-volume';
    }

    async readFiles(files?: string[]) {
      const payload = { Findings: [] };
      if (!files || files.length === 0) {
        return { 'sentris.0001.json': JSON.stringify(payload) };
      }
      return Object.fromEntries(files.map((file) => [file, JSON.stringify(payload)]));
    }

    async cleanup() {}
  },
}));

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('prowler-scan component', () => {
  beforeAll(async () => {
    await import('../prowler-scan');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds aws scan command with recommended severity and ignore-exit-code flags', async () => {
    const component = componentRegistry.get<any, any>('security.prowler.scan');
    if (!component) throw new Error('Prowler component was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(
      {
        inputs: {
          accountId: '123456789012',
          regions: 'us-east-1',
          credentials: {
            accessKeyId: 'AKIA_TEST',
            secretAccessKey: 'secret',
          },
        },
        params: {
          scanMode: 'aws',
          recommendedFlags: ['severity-high-critical', 'ignore-exit-code', 'no-banner'],
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'prowler-cli' }),
    );

    const runnerConfig = runSpy.mock.calls[0]?.[0] as { command?: string[] } | undefined;
    const command = runnerConfig?.command ?? [];

    expect(command[0]).toBe('aws');
    expect(command).toContain('--region');
    expect(command).toContain('us-east-1');
    expect(command).toContain('--severity');
    expect(command).toContain('high');
    expect(command).toContain('critical');
    expect(command).toContain('--ignore-exit-code-3');
    expect(command).toContain('--no-banner');
  });

  it('appends custom CLI flags to the prowler command', async () => {
    const component = componentRegistry.get<any, any>('security.prowler.scan');
    if (!component) throw new Error('Prowler component was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(
      {
        inputs: {
          accountId: '123456789012',
          credentials: {
            accessKeyId: 'AKIA_TEST',
            secretAccessKey: 'secret',
          },
        },
        params: {
          scanMode: 'aws',
          recommendedFlags: [],
          customFlags: '--compliance cis_1.4_aws',
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'prowler-custom-flags' }),
    );

    const command =
      (runSpy.mock.calls[0]?.[0] as { command?: string[] } | undefined)?.command ?? [];
    expect(command).toContain('--compliance');
    expect(command).toContain('cis_1.4_aws');
  });
});
