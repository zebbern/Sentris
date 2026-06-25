import { beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';

const initializedVolumes: Record<string, string | Buffer>[] = [];

mock.module('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    static attachExisting(_tenantId: string, _runId: string, volumeName: string) {
      return new this(volumeName);
    }

    constructor(private readonly volumeName = 'mock-jazzer-volume') {}

    async initialize(files: Record<string, string | Buffer>) {
      initializedVolumes.push(files);
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

describe('Jazzer.js scanner component', () => {
  beforeAll(async () => {
    await import('../jazzer-js');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    initializedVolumes.length = 0;
  });

  it('skips fuzzing with a caveat when no harness targets are provided', async () => {
    const component = componentRegistry.get<any, any>('sentris.jazzer-js.run');
    if (!component) throw new Error('Jazzer.js component was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');
    runSpy.mockClear();
    const result = (await component.execute(
      {
        inputs: {
          volumeName: 'npm-source-volume',
          scanPath: '/repo',
          fuzzTargets: [],
        },
        params: {},
      },
      sdk.createExecutionContext({ runId: 'jazzer-skip-run', componentRef: 'jazzer' }),
    )) as { scanStatus: string; caveats: string[]; crashCount: number };

    expect(runSpy).not.toHaveBeenCalled();
    expect(result.scanStatus).toBe('skipped');
    expect(result.crashCount).toBe(0);
    expect(result.caveats.join(' ')).toContain('No Jazzer.js fuzz targets');
  });

  it('materializes fuzz targets, runs Jazzer.js, and records crashes', async () => {
    const component = componentRegistry.get<any, any>('sentris.jazzer-js.run');
    if (!component) throw new Error('Jazzer.js component was not registered');

    const runSpy = vi
      .spyOn(sdk, 'runComponentWithRunner')
      .mockResolvedValue(
        [
          'INFO: Running target parseBuffer',
          '==ERROR: Jazzer.js: uncaught exception TypeError: boom',
          'Crash input written to /crashes/crash-001',
          'Reproducer command: npx jazzer /fuzz-targets/001-parseBuffer.js /crashes/crash-001',
        ].join('\n'),
      );

    const result = (await component.execute(
      {
        inputs: {
          volumeName: 'npm-source-volume',
          scanPath: '/repo',
          fuzzTargets: [
            {
              name: 'parseBuffer',
              code: 'module.exports.fuzz = function(data) { require("/repo").parse(data); };',
              rationale: 'Parser accepts untrusted bytes.',
            },
          ],
        },
        params: {
          timeoutSeconds: 45,
          maxCrashes: 2,
        },
      },
      sdk.createExecutionContext({ runId: 'jazzer-crash-run', componentRef: 'jazzer' }),
    )) as {
      scanStatus: string;
      crashCount: number;
      crashes: { targetName: string; error: string; crashPath?: string }[];
      harnessSummary: { targetCount: number };
    };

    const runner = runSpy.mock.calls.at(-1)?.[0] as {
      command?: string[];
      timeoutSeconds?: number;
    };
    expect(Object.keys(initializedVolumes[0] ?? {})).toEqual(['001-parseBuffer.js']);
    expect(runner.timeoutSeconds).toBe(45);
    expect(runner.command).toEqual(['sh', '-lc', expect.any(String)]);
    expect(runner.command?.join(' ')).toContain('@jazzer.js/core');
    expect(runner.command?.[2]).not.toContain('cd /work for TARGET');
    expect(runner.command?.[2]).toContain('cd /work\nfor TARGET in /fuzz-targets/001-*.js; do');
    expect(result.scanStatus).toBe('crashed');
    expect(result.harnessSummary.targetCount).toBe(1);
    expect(result.crashCount).toBe(1);
    expect(result.crashes[0]).toMatchObject({
      targetName: 'parseBuffer',
      crashPath: '/crashes/crash-001',
    });
  });

  it('classifies harness failures separately from confirmed crashes', async () => {
    const component = componentRegistry.get<any, any>('sentris.jazzer-js.run');
    if (!component) throw new Error('Jazzer.js component was not registered');

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      [
        'SENTRIS_JAZZER_TARGET_START:001-parseBuffer',
        'Error: Cannot find module "/repo"',
        'SENTRIS_JAZZER_TARGET_EXIT:001-parseBuffer:1',
      ].join('\n'),
    );

    const result = (await component.execute(
      {
        inputs: {
          volumeName: 'npm-source-volume',
          scanPath: '/repo',
          fuzzTargets: [
            {
              name: 'parseBuffer',
              code: 'module.exports.fuzz = function(data) { require("/repo").parse(data); };',
              rationale: 'Parser accepts untrusted bytes.',
            },
          ],
        },
        params: {
          maxCrashes: 2,
        },
      },
      sdk.createExecutionContext({ runId: 'jazzer-harness-failure-run', componentRef: 'jazzer' }),
    )) as {
      scanStatus: string;
      crashCount: number;
      crashes: unknown[];
      caveats: string[];
      harnessStatuses: { targetName: string; status: string; exitCode?: number }[];
    };

    expect(result.scanStatus).toBe('failed');
    expect(result.crashCount).toBe(0);
    expect(result.crashes).toEqual([]);
    expect(result.harnessStatuses).toEqual([
      { targetName: 'parseBuffer', status: 'failed', exitCode: 1 },
    ]);
    expect(result.caveats.join(' ')).toContain('parseBuffer exited with code 1');
  });
});
