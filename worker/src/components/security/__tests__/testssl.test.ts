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

interface TestsslTestResult {
  findings: {
    id: string;
    severity: string;
    finding: string;
    cve?: string;
    cwe?: string;
  }[];
  results: Record<string, unknown>[];
  findingCount: number;
}

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('testssl component', () => {
  beforeAll(async () => {
    await import('../testssl');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    mockReadFiles = async () => ({ 'results.json': '[]' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('honors the requested timeout instead of raising it to the runner default', async () => {
    const component = componentRegistry.get<any, any>('sentris.testssl.run');
    if (!component) throw new Error('testssl component was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(
      {
        inputs: {
          target: 'example.com:443',
        },
        params: {
          timeout: 600,
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'testssl-timeout' }),
    );

    const runnerConfig = runSpy.mock.calls[0]?.[0] as { timeoutSeconds?: number } | undefined;

    expect(runnerConfig?.timeoutSeconds).toBe(600);
  });

  it('builds selective testssl flags and parses JSON result files', async () => {
    const component = componentRegistry.get<any, any>('sentris.testssl.run');
    if (!component) throw new Error('testssl component was not registered');

    mockReadFiles = async () => ({
      'results.json': JSON.stringify([
        {
          id: 'TLS1_0',
          severity: 'HIGH',
          finding: 'TLS 1.0 is offered',
          cve: 'CVE-2011-3389',
        },
        {
          id: 'HSTS',
          severity: 'LOW',
          finding: 'HSTS header missing',
          cwe: 'CWE-319',
        },
      ]),
    });
    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({ stdout: '' });

    const result = (await component.execute(
      {
        inputs: {
          target: 'example.com:443',
        },
        params: {
          protocols: true,
          ciphers: false,
          vulnerabilities: true,
          timeout: 300,
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'testssl-json' }),
    )) as TestsslTestResult;

    const runnerConfig = runSpy.mock.calls[0]?.[0] as { command?: string[] } | undefined;
    const command = runnerConfig?.command ?? [];

    expect(command).toContain('--jsonfile');
    expect(command).toContain('/output/results.json');
    expect(command).toContain('--protocols');
    expect(command).toContain('--vulnerable');
    expect(command).not.toContain('--std');
    expect(command.at(-1)).toBe('example.com:443');
    expect(result.findingCount).toBe(2);
    expect(result.findings[0]).toMatchObject({
      id: 'TLS1_0',
      severity: 'HIGH',
      finding: 'TLS 1.0 is offered',
      cve: 'CVE-2011-3389',
    });
    expect(result.results[0]).toMatchObject({
      scanner: 'testssl',
      severity: 'high',
      target: 'example.com:443',
    });
  });

  it('falls back to stdout JSON when the result file is missing', async () => {
    const component = componentRegistry.get<any, any>('sentris.testssl.run');
    if (!component) throw new Error('testssl component was not registered');

    mockReadFiles = async () => ({});
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify([
        {
          id: 'ROBOT',
          severity: 'CRITICAL',
          finding: 'ROBOT vulnerability detected',
        },
      ]),
    );

    const result = (await component.execute(
      {
        inputs: {
          target: 'example.com:443',
        },
        params: {
          timeout: 300,
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'testssl-stdout' }),
    )) as TestsslTestResult;

    expect(result.findingCount).toBe(1);
    expect(result.findings[0]).toMatchObject({
      id: 'ROBOT',
      severity: 'CRITICAL',
      finding: 'ROBOT vulnerability detected',
    });
    expect(result.results[0]).toMatchObject({
      severity: 'critical',
      id: 'ROBOT',
    });
  });
});
