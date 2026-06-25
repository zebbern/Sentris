import { beforeAll, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';

const volumeConfigs: { source: string; target: string; readOnly: boolean }[] = [];
let mockReadFiles: Record<string, string> = {};
let createdVolumeIndex = 0;

mock.module('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    static attachExisting(_tenantId: string, _runId: string, volumeName: string) {
      return new this('_tenant', '_run', { attachTo: volumeName });
    }

    private readonly volumeName: string;

    constructor(
      _tenantId = 'mock-tenant',
      runId = 'mock-run',
      options: { attachTo?: string } = {},
    ) {
      this.volumeName = options.attachTo ?? `mock-codeql-volume-${runId}-${createdVolumeIndex++}`;
    }

    async initialize() {
      return this.volumeName;
    }

    getVolumeConfig(containerPath = '/repo', readOnly = true) {
      const config = { source: this.volumeName, target: containerPath, readOnly };
      volumeConfigs.push(config);
      return config;
    }

    getVolumeName() {
      return this.volumeName;
    }

    async readFiles(_filenames: string[]) {
      return mockReadFiles;
    }

    async cleanup() {}
  },
}));

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('CodeQL scanner component', () => {
  beforeAll(async () => {
    await import('../codeql');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  it('constructs a JS/TS CodeQL database and normalizes SARIF findings', async () => {
    const component = componentRegistry.get<any, any>('sentris.codeql.run');
    if (!component) throw new Error('CodeQL component was not registered');

    const sarif = JSON.stringify({
      runs: [
        {
          tool: {
            driver: {
              name: 'CodeQL',
              rules: [
                {
                  id: 'js/path-injection',
                  shortDescription: { text: 'Uncontrolled data used in path expression' },
                  properties: {
                    tags: ['security', 'external/cwe/cwe-022'],
                    'security-severity': '8.1',
                  },
                },
              ],
            },
          },
          results: [
            {
              ruleId: 'js/path-injection',
              level: 'error',
              message: { text: 'Untrusted input reaches fs.readFileSync.' },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'src/server.ts' },
                    region: { startLine: 12, endLine: 14 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    mockReadFiles = { 'codeql-results.sarif': sarif };
    const runSpy = vi
      .spyOn(sdk, 'runComponentWithRunner')
      .mockResolvedValue('CodeQL command-line toolchain release 2.25.6.');

    const result = (await component.execute(
      {
        inputs: {
          volumeName: 'npm-source-volume',
          scanPath: '/repo',
        },
        params: {
          language: 'javascript-typescript',
          querySuite: 'security-extended',
          timeoutSeconds: 900,
        },
      },
      sdk.createExecutionContext({ runId: 'codeql-test-run', componentRef: 'codeql' }),
    )) as {
      findingCount: number;
      findings: { ruleId: string; path: string; startLine: number; severity: string }[];
      scanStatus: string;
      caveats: string[];
    };

    const runner = runSpy.mock.calls[0]?.[0] as {
      command?: string[];
      entrypoint?: string;
      image?: string;
      timeoutSeconds?: number;
      volumes?: { source: string; target: string; readOnly?: boolean }[];
    };
    const command = runner.command ?? [];
    const shellScript = String(command[1] ?? '');
    expect(runner.image).toBe('node:22-trixie-slim');
    expect(runner.entrypoint).toBe('sh');
    expect(command).toEqual(['-lc', expect.any(String)]);
    expect(shellScript).toContain('codeql-bundle-v2.25.6/codeql-bundle-linux64.tar.gz');
    expect(shellScript).toContain('CODEQL_HOME="$CODEQL_CACHE/codeql"');
    expect(shellScript).toContain("--output='/codeql-output/codeql-results.sarif'");
    expect(shellScript).toContain("test -s '/codeql-output/codeql-results.sarif'");
    expect(shellScript).toContain('__SENTRIS_CODEQL_SARIF_BEGIN__');
    expect(shellScript).not.toContain('then &&');
    expect(command.join(' ')).toContain('codeql database create');
    expect(command.join(' ')).toContain('--language=javascript');
    expect(command.join(' ')).toContain('javascript-security-extended.qls');
    expect(runner.timeoutSeconds).toBe(900);
    expect(volumeConfigs[0]).toMatchObject({
      source: 'npm-source-volume',
      target: '/repo',
      readOnly: true,
    });
    expect(runner.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'sentris-codeql-bundle-cache',
          target: '/codeql-cache',
          readOnly: false,
        }),
        expect.objectContaining({
          target: '/codeql-output',
          readOnly: false,
        }),
      ]),
    );
    expect(result.scanStatus).toBe('completed');
    expect(result.caveats).toEqual([]);
    expect(result.findingCount).toBe(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'js/path-injection',
      path: 'src/server.ts',
      startLine: 12,
      severity: 'error',
    });
  });
});
