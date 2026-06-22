import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';

let mockReadFiles: () => Promise<Record<string, string>>;

interface Wafw00fTestResult {
  wafDetections: {
    url: string;
    detected: boolean;
    firewall: string;
    manufacturer: string;
  }[];
  results: Record<string, unknown>[];
  detectionCount: number;
}

mock.module('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    async initialize() {}

    getVolumeConfig(containerPath = '/output', readOnly = false) {
      return { source: 'mock-volume', target: containerPath, readOnly };
    }

    getVolumeName() {
      return 'mock-volume';
    }

    async readFiles() {
      return mockReadFiles();
    }

    async cleanup() {}
  },
}));

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('wafw00f component', () => {
  beforeAll(async () => {
    await import('../wafw00f');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    mockReadFiles = async () => ({
      'results.json': JSON.stringify([
        {
          url: 'https://example.com',
          detected: true,
          firewall: 'Cloudflare',
          manufacturer: 'Cloudflare Inc.',
        },
      ]),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs wafw00f with mounted target and output files', async () => {
    const component = componentRegistry.get<any, any>('sentris.wafw00f.run');
    if (!component) throw new Error('wafw00f component was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({ stdout: '' });

    const result = (await component.execute(
      {
        inputs: {
          targets: ['https://example.com'],
        },
        params: {
          findAll: true,
          verbose: true,
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'wafw00f-command' }),
    )) as Wafw00fTestResult;

    const runnerConfig = runSpy.mock.calls[0]?.[0] as
      | { image?: string; entrypoint?: string; command?: string[] }
      | undefined;
    const shellCommand = runnerConfig?.command?.join(' ') ?? '';

    expect(runnerConfig?.image).toBe('python:3.11-slim');
    expect(runnerConfig?.entrypoint).toBe('sh');
    expect(shellCommand).toContain('pip install wafw00f -q');
    expect(shellCommand).toContain("'-i' '/input/targets.txt'");
    expect(shellCommand).toContain("'-o' '/output/results.json'");
    expect(shellCommand).toContain("'-f' 'json'");
    expect(shellCommand).toContain("'-a'");
    expect(shellCommand).toContain("'-v'");
    expect(result.detectionCount).toBe(1);
    expect(result.wafDetections[0]).toMatchObject({
      url: 'https://example.com',
      detected: true,
      firewall: 'Cloudflare',
    });
    expect(result.results[0]).toMatchObject({
      scanner: 'wafw00f',
      severity: 'info',
      asset_key: 'https://example.com',
    });
  });

  it('falls back to stdout JSON when the result file is unavailable', async () => {
    const component = componentRegistry.get<any, any>('sentris.wafw00f.run');
    if (!component) throw new Error('wafw00f component was not registered');

    mockReadFiles = async () => ({});
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify([
        {
          url: 'https://unprotected.example.com',
          detected: false,
          firewall: 'None',
          manufacturer: '',
        },
      ]),
    );

    const result = (await component.execute(
      {
        inputs: {
          targets: ['https://unprotected.example.com'],
        },
        params: {},
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'wafw00f-stdout' }),
    )) as Wafw00fTestResult;

    expect(result.detectionCount).toBe(0);
    expect(result.wafDetections).toEqual([
      {
        url: 'https://unprotected.example.com',
        detected: false,
        firewall: 'None',
        manufacturer: '',
      },
    ]);
  });
});
