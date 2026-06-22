import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';

let mockReadFiles: () => Promise<Record<string, string>>;

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

interface TheHarvesterTestResult {
  emails: string[];
  subdomains: string[];
  ips: string[];
  results: Record<string, unknown>[];
  totalFindings: number;
}

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('theHarvester component', () => {
  beforeAll(async () => {
    await import('../theharvester');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    mockReadFiles = async () => ({
      'results.json': JSON.stringify({
        emails: ['admin@example.com', 'admin@example.com'],
        hosts: ['www.example.com', 'api.example.com'],
        ips: ['93.184.216.34'],
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs theHarvester directly and parses JSON result files', async () => {
    const component = componentRegistry.get<any, any>('sentris.theharvester.run');
    if (!component) throw new Error('theHarvester component was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({ stdout: '' });

    const result = (await component.execute(
      {
        inputs: {
          domain: 'example.com',
        },
        params: {
          sources: 'crtsh,hackertarget',
          limit: 50,
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'theharvester-json' }),
    )) as TheHarvesterTestResult;

    const runnerConfig = runSpy.mock.calls[0]?.[0] as
      | { image?: string; entrypoint?: string; command?: string[] }
      | undefined;
    const command = runnerConfig?.command ?? [];

    expect(runnerConfig?.image).toBe('ghcr.io/laramies/theharvester:latest');
    expect(runnerConfig?.entrypoint).toBe('theHarvester');
    expect(command).toEqual(
      expect.arrayContaining([
        '-d',
        'example.com',
        '-l',
        '50',
        '-b',
        'crtsh,hackertarget',
        '-f',
        '/output/results.json',
      ]),
    );
    expect(result.emails).toEqual(['admin@example.com']);
    expect(result.subdomains).toEqual(['www.example.com', 'api.example.com']);
    expect(result.ips).toEqual(['93.184.216.34']);
    expect(result.totalFindings).toBe(4);
    expect(result.results.map((item) => item.type)).toEqual([
      'email',
      'subdomain',
      'subdomain',
      'ip',
    ]);
  });

  it('falls back to parsing stdout when no JSON result file is available', async () => {
    const component = componentRegistry.get<any, any>('sentris.theharvester.run');
    if (!component) throw new Error('theHarvester component was not registered');

    mockReadFiles = async () => ({});
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(`Emails found:
admin@example.com

Hosts found:
www.example.com
api.example.com

IP addresses found:
93.184.216.34
`);

    const result = (await component.execute(
      {
        inputs: {
          domain: 'example.com',
        },
        params: {},
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'theharvester-stdout' }),
    )) as TheHarvesterTestResult;

    expect(result.emails).toEqual(['admin@example.com']);
    expect(result.subdomains).toEqual(['www.example.com', 'api.example.com']);
    expect(result.ips).toEqual(['93.184.216.34']);
    expect(result.totalFindings).toBe(4);
  });
});
