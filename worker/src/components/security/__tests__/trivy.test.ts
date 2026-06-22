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

describe('trivy component', () => {
  beforeAll(async () => {
    await import('../trivy');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects output formats that cannot be parsed into vulnerability results', () => {
    const component = componentRegistry.get<any, any>('sentris.trivy.run');
    if (!component) throw new Error('Trivy component was not registered');

    expect(component.parameters!.safeParse({ format: 'sarif' }).success).toBe(false);
    expect(component.parameters!.safeParse({ format: 'table' }).success).toBe(false);
    expect(component.parameters!.safeParse({ format: 'json' }).success).toBe(true);
  });

  it('rejects custom output format overrides before running Trivy', async () => {
    const component = componentRegistry.get<any, any>('sentris.trivy.run');
    if (!component) throw new Error('Trivy component was not registered');

    const runSpy = vi
      .spyOn(sdk, 'runComponentWithRunner')
      .mockResolvedValue(JSON.stringify({ Results: [] }));

    await expect(
      component.execute(
        {
          inputs: {
            target: 'https://github.com/OWASP/NodeGoat',
            customFlags: '--format sarif',
          },
          params: {
            scanType: 'repo',
            format: 'json',
          },
        },
        sdk.createExecutionContext({ runId: 'test-run', componentRef: 'trivy-format-override' }),
      ),
    ).rejects.toThrow(/output format/i);

    expect(runSpy).not.toHaveBeenCalled();
  });

  it('passes repository refs as branch selectors for repo scans', async () => {
    const component = componentRegistry.get<any, any>('sentris.trivy.run');
    if (!component) throw new Error('Trivy component was not registered');

    const runSpy = vi
      .spyOn(sdk, 'runComponentWithRunner')
      .mockResolvedValue(JSON.stringify({ Results: [] }));

    await component.execute(
      {
        inputs: {
          target: 'https://github.com/OWASP/NodeGoat',
          ref: 'master',
        },
        params: {
          scanType: 'repo',
          format: 'json',
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'trivy-repo-ref' }),
    );

    const command = (runSpy.mock.calls[0]?.[0] as { command?: string[] } | undefined)?.command;

    expect(command).toEqual(
      expect.arrayContaining([
        'repo',
        'https://github.com/OWASP/NodeGoat',
        '--format',
        'json',
        '--branch',
        'master',
      ]),
    );
  });

  it('parses vulnerability JSON even when runner output includes surrounding log text', async () => {
    const component = componentRegistry.get<any, any>('sentris.trivy.run');
    if (!component) throw new Error('Trivy component was not registered');

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(`2026-06-21T20:00:00Z INFO DB cached
{
  "Results": [
    {
      "Target": "package-lock.json",
      "Vulnerabilities": [
        {
          "VulnerabilityID": "CVE-2021-23337",
          "PkgName": "lodash",
          "InstalledVersion": "4.17.20",
          "FixedVersion": "4.17.21",
          "Severity": "HIGH",
          "Title": "Command Injection in lodash",
          "PrimaryURL": "https://avd.aquasec.com/nvd/cve-2021-23337"
        }
      ]
    }
  ]
}
Scan finished`);

    const result = (await component.execute(
      {
        inputs: {
          target: 'https://github.com/OWASP/NodeGoat',
          ref: 'master',
        },
        params: {
          scanType: 'repo',
          format: 'json',
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'trivy-mixed-output' }),
    )) as {
      vulnerabilityCount: number;
      vulnerabilities: { vulnerabilityId: string; pkgName: string; severity: string }[];
      results: { severity: string; vulnerability_id: string }[];
    };

    expect(result.vulnerabilityCount).toBe(1);
    expect(result.vulnerabilities[0]).toMatchObject({
      vulnerabilityId: 'CVE-2021-23337',
      pkgName: 'lodash',
      severity: 'HIGH',
    });
    expect(result.results[0]).toMatchObject({
      severity: 'high',
      vulnerability_id: 'CVE-2021-23337',
    });
  });
});
