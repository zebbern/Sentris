import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

import * as testFileRunnerModule from '../lib/test-file-runner';

type TestRun = {
  label: string;
  files: string[];
  serial: boolean;
};

const { collectTestFiles, runTestFilePlan } =
  testFileRunnerModule as typeof testFileRunnerModule & {
    collectTestFiles: (directories: string[]) => string[];
    runTestFilePlan: (options: {
      runs: TestRun[];
      concurrency?: number;
      root?: string;
      createStep: (run: TestRun) => { command: string; args: string[] };
      runStep?: (step: { args: string[] }, options: { root?: string }) => Promise<number>;
    }) => Promise<number>;
  };

function createRun(label: string, serial = false): TestRun {
  return { label, files: [`${label}.test.ts`], serial };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error('Timed out waiting for scheduler state');
}

describe('isolated test-file runner', () => {
  it('collects test files recursively in deterministic order', () => {
    const root = mkdtempSync(join(tmpdir(), 'sentris-test-files-'));
    const firstDirectory = join(root, 'first');
    const nestedDirectory = join(firstDirectory, 'nested');
    const secondDirectory = join(root, 'second');

    try {
      mkdirSync(nestedDirectory, { recursive: true });
      mkdirSync(secondDirectory, { recursive: true });
      writeFileSync(join(firstDirectory, 'z.test.ts'), '');
      writeFileSync(join(nestedDirectory, 'a.spec.ts'), '');
      writeFileSync(join(nestedDirectory, 'ignored.ts'), '');
      writeFileSync(join(secondDirectory, 'b.test.tsx'), '');

      expect(collectTestFiles([secondDirectory, firstDirectory])).toEqual([
        join(firstDirectory, 'nested', 'a.spec.ts'),
        join(firstDirectory, 'z.test.ts'),
        join(secondDirectory, 'b.test.tsx'),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bounds ordinary concurrency and starts serial runs only after success', async () => {
    let active = 0;
    let maximumActive = 0;
    const started: string[] = [];

    const status = await runTestFilePlan({
      runs: [
        createRun('a'),
        createRun('b'),
        createRun('c'),
        createRun('d'),
        createRun('serial', true),
      ],
      concurrency: 3,
      createStep: (run) => ({ command: 'bun', args: [run.label] }),
      runStep: async (step) => {
        const label = step.args[0]!;
        if (label === 'serial') expect(active).toBe(0);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        started.push(label);
        await Bun.sleep(5);
        active -= 1;
        return 0;
      },
    });

    expect(status).toBe(0);
    expect(maximumActive).toBe(3);
    expect(started.at(-1)).toBe('serial');
  });

  it('stops scheduling new runs after a failure and waits for active runs', async () => {
    const started: string[] = [];
    const settled: string[] = [];
    const releases = new Map<string, (status: number) => void>();

    const execution = runTestFilePlan({
      runs: [createRun('a'), createRun('b'), createRun('c'), createRun('serial', true)],
      concurrency: 2,
      createStep: (run) => ({ command: 'bun', args: [run.label] }),
      runStep: (step) => {
        const label = step.args[0]!;
        started.push(label);
        return new Promise<number>((resolve) => {
          releases.set(label, (status) => {
            settled.push(label);
            resolve(status);
          });
        });
      },
    });

    await waitFor(() => started.length === 2);
    expect(started).toEqual(['a', 'b']);
    releases.get('b')!(1);
    await Bun.sleep(5);
    expect(started).toEqual(['a', 'b']);
    releases.get('a')!(0);

    expect(await execution).toBe(1);
    expect(settled.sort()).toEqual(['a', 'b']);
    expect(started).not.toContain('c');
    expect(started).not.toContain('serial');
  });
});
