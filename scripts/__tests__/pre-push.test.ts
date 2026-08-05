import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

import * as prePushModule from '../pre-push';

const {
  acquirePrePushVerification,
  completePrePushVerification,
  createPrePushPlan,
  isTestFile,
  parseArgs,
  releasePrePushVerification,
} = prePushModule as typeof prePushModule & {
  acquirePrePushVerification: (options: {
    cacheDirectory: string;
    key: string;
    processId?: number;
  }) =>
    | { status: 'acquired'; key: string; token: string; lockPath: string; receiptPath: string }
    | { status: 'busy'; processId: number }
    | { status: 'cached' };
  completePrePushVerification: (guard: {
    key: string;
    token: string;
    lockPath: string;
    receiptPath: string;
  }) => void;
  releasePrePushVerification: (guard: { token: string; lockPath: string }) => void;
  createPrePushPlan: (files: string[]) => {
    changedFiles: string[];
    affectedDirectories: string[];
    commands: Array<{ command: string; args: string[]; cwd?: string }>;
  };
  isTestFile: (file: string) => boolean;
  parseArgs: (args: string[]) => {
    dryRun: boolean;
    remoteName: string;
    base?: string;
    head?: string;
  };
};

describe('pre-push planner', () => {
  it('skips code validation for documentation-only pushes', () => {
    expect(createPrePushPlan(['docs/development/local.mdx'])).toEqual({
      changedFiles: ['docs/development/local.mdx'],
      affectedDirectories: [],
      commands: [],
    });
  });

  it('checks one changed app and runs only its changed tests', () => {
    const plan = createPrePushPlan([
      'frontend/src/features/operator/OperatorPlanCard.tsx',
      'frontend/src/features/operator/__tests__/OperatorTimeline.test.tsx',
    ]);

    expect(plan.affectedDirectories).toEqual(['frontend']);
    expect(plan.commands).toEqual([
      {
        command: 'bun',
        args: ['x', 'tsc', '--build', 'frontend'],
        timeoutMs: 300_000,
      },
      {
        command: 'bun',
        args: [
          'src/test/run-tests-serial.ts',
          'src/features/operator/__tests__/OperatorTimeline.test.tsx',
        ],
        cwd: 'frontend',
        timeoutMs: 300_000,
      },
    ]);
  });

  it('checks transitive consumers of a shared package without unrelated workspaces', () => {
    const plan = createPrePushPlan(['packages/shared/src/operator.ts']);

    expect(plan.affectedDirectories).toEqual([
      'frontend',
      'backend',
      'worker',
      'packages/component-sdk',
      'packages/contracts',
      'packages/shared',
    ]);
    expect(plan.commands).toHaveLength(1);
  });

  it('keeps script and E2E validation focused', () => {
    const plan = createPrePushPlan([
      'scripts/pre-push.js',
      'scripts/__tests__/pre-push.test.ts',
      'e2e-tests/core/operator-plan.test.ts',
    ]);

    expect(plan.commands).toEqual([
      { command: 'bun', args: ['run', 'typecheck:e2e'], timeoutMs: 300_000 },
      {
        command: 'bun',
        args: ['test', 'scripts/__tests__/pre-push.test.ts'],
        timeoutMs: 300_000,
      },
    ]);
    expect(isTestFile('worker/src/example/__tests__/example.test.ts')).toBe(true);
    expect(isTestFile('frontend/src/example.tsx')).toBe(false);
    expect(parseArgs(['origin', '--dry-run', '--base', 'a', '--head', 'b'])).toEqual({
      dryRun: true,
      remoteName: 'origin',
      base: 'a',
      head: 'b',
    });
    expect(() => parseArgs(['--base'])).toThrow('--base requires a Git ref');
  });

  it('typechecks deleted source paths without trying to execute deleted tests', () => {
    const plan = createPrePushPlan(['worker/src/example/__tests__/deleted.test.ts']);

    expect(plan.affectedDirectories).toContain('worker');
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0]?.args.slice(0, 3)).toEqual(['x', 'tsc', '--build']);
  });

  it('prevents duplicate verification and reuses a completed result for the same commit', () => {
    const cacheDirectory = mkdtempSync(join(tmpdir(), 'sentris-pre-push-'));

    try {
      const first = acquirePrePushVerification({
        cacheDirectory,
        key: 'commit-a',
        processId: process.pid,
      });
      expect(first.status).toBe('acquired');
      if (first.status !== 'acquired') throw new Error('Expected the first guard to be acquired');

      expect(
        acquirePrePushVerification({
          cacheDirectory,
          key: 'commit-a',
          processId: process.pid,
        }),
      ).toEqual({ status: 'busy', processId: process.pid });

      completePrePushVerification(first);
      releasePrePushVerification(first);

      expect(
        acquirePrePushVerification({
          cacheDirectory,
          key: 'commit-a',
          processId: process.pid,
        }),
      ).toEqual({ status: 'cached' });
    } finally {
      rmSync(cacheDirectory, { recursive: true, force: true });
    }
  });
});
