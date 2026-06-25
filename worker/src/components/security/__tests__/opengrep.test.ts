import { beforeAll, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';

mock.module('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    static attachExisting(_tenantId: string, _runId: string, volumeName: string) {
      return new this(volumeName);
    }

    constructor(private readonly volumeName = 'mock-opengrep-volume') {}

    async initialize() {
      return this.volumeName;
    }

    getVolumeConfig(containerPath = '/inputs', readOnly = true) {
      return { source: this.volumeName, target: containerPath, readOnly };
    }

    getVolumeName() {
      return this.volumeName;
    }

    async cleanup() {}
  },
}));

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('OpenGrep scanner component', () => {
  beforeAll(async () => {
    await import('../opengrep');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  it('runs OpenGrep with Semgrep-compatible JSON and normalizes findings', async () => {
    const component = componentRegistry.get<any, any>('sentris.opengrep.run');
    if (!component) throw new Error('OpenGrep component was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify({
        results: [
          {
            check_id: 'javascript.lang.security.audit.detect-non-literal-fs-filename',
            path: 'src/server.js',
            start: { line: 7 },
            end: { line: 7 },
            extra: {
              message: 'Non-literal filename reaches fs.readFileSync.',
              severity: 'WARNING',
              metadata: { cwe: ['CWE-22'] },
            },
          },
        ],
      }),
    );

    const result = (await component.execute(
      {
        inputs: {
          volumeName: 'npm-source-volume',
          scanPath: '/repo',
        },
        params: {
          configs: ['p/security-audit', 'p/javascript'],
          timeoutSeconds: 900,
        },
      },
      sdk.createExecutionContext({ runId: 'opengrep-test-run', componentRef: 'opengrep' }),
    )) as {
      findingCount: number;
      findings: { checkId: string; severity: string; cwe?: string[] }[];
      scanStatus: string;
      caveats: string[];
    };

    const runner = runSpy.mock.calls.at(-1)?.[0] as {
      command?: string[];
      entrypoint?: string;
      image?: string;
      timeoutSeconds?: number;
    };
    const command = runner.command ?? [];
    expect(runner.image).toBe('debian:bookworm-slim');
    expect(runner.entrypoint).toBe('sh');
    expect(command).toEqual(['-lc', expect.any(String)]);
    expect(command[1]).toContain('https://github.com/opengrep/opengrep/releases/download/v1.23.0');
    expect(command[1]).not.toContain('raw.githubusercontent.com/opengrep/opengrep/main/install.sh');
    expect(command[1]).toContain("\"$OPENGREP_BIN\" 'scan' '--json' '--quiet'");
    expect(command[1]).toContain("'--config' 'p/security-audit'");
    expect(command[1]).toContain("'--config' 'p/javascript'");
    expect(runner.timeoutSeconds).toBe(900);
    expect(result.scanStatus).toBe('completed');
    expect(result.caveats).toEqual([]);
    expect(result.findingCount).toBe(1);
    expect(result.findings[0]).toMatchObject({
      checkId: 'javascript.lang.security.audit.detect-non-literal-fs-filename',
      severity: 'WARNING',
      cwe: ['CWE-22'],
    });
  });
});
