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

    async readFiles() {
      return { 'results.json': '{}' };
    }

    async cleanup() {}
  },
}));

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('security component CLI mapping', () => {
  beforeAll(async () => {
    await import('../register-all');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps naabu port selections to -p flags', async () => {
    const component = componentRegistry.get<any, any>('sentris.naabu.scan');
    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component!.execute(
      {
        inputs: { targets: ['scanme.nmap.org'] },
        params: { ports: '80,443', rate: 500 },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'naabu-cli' }),
    );

    const command =
      (runSpy.mock.calls[0]?.[0] as { command?: string[] } | undefined)?.command ?? [];
    expect(command).toContain('-p');
    expect(command.join(' ')).toContain('80,443');
  });

  it('maps testssl timeout parameter to runner timeoutSeconds', async () => {
    const component = componentRegistry.get<any, any>('sentris.testssl.run');
    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component!.execute(
      {
        inputs: { target: 'scanme.nmap.org', customFlags: '--quiet' },
        params: { timeout: 120 },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'testssl-cli' }),
    );

    const runnerConfig = runSpy.mock.calls[0]?.[0] as
      | { command?: string[]; timeoutSeconds?: number }
      | undefined;
    expect(runnerConfig?.timeoutSeconds).toBe(120);
    expect(runnerConfig?.command).toContain('--quiet');
  });

  it('maps nuclei severity filters to -severity', async () => {
    const component = componentRegistry.get<any, any>('sentris.nuclei.scan');
    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component!.execute(
      {
        inputs: { targets: ['https://scanme.nmap.org'] },
        params: { severityFilter: ['high', 'critical'], rateLimit: 10 },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'nuclei-cli' }),
    );

    const command =
      (runSpy.mock.calls[0]?.[0] as { command?: string[] } | undefined)?.command ?? [];
    expect(command).toContain('-s');
    expect(command.join(' ')).toContain('high');
  });
});
