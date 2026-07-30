import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';

import {
  collectTestFiles,
  planExplicitFrontendTestRuns,
  planFrontendTestRuns,
  usesMockModule,
} from './run-tests-plan';

describe('frontend test runner planning', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('collects test files recursively in deterministic order', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'sentris-test-plan-'));
    writeFileSync(path.join(tempDir, 'z.test.ts'), '');
    writeFileSync(path.join(tempDir, 'component.ts'), '');

    const nested = path.join(tempDir, 'nested');
    mkdirSync(nested);
    writeFileSync(path.join(tempDir, 'a.spec.tsx'), '');
    writeFileSync(path.join(tempDir, 'readme.md'), '');
    writeFileSync(path.join(nested, 'b.test.ts'), '');

    expect(collectTestFiles(tempDir).map((file) => path.relative(tempDir!, file))).toEqual([
      'a.spec.tsx',
      path.join('nested', 'b.test.ts'),
      'z.test.ts',
    ]);
  });

  it('detects direct mock.module usage', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'sentris-test-plan-'));
    const mocked = path.join(tempDir, 'mocked.test.ts');
    const plain = path.join(tempDir, 'plain.test.ts');

    writeFileSync(
      mocked,
      "import { mock } from 'bun:test';\nmock.module('@/store', () => ({}));\n",
    );
    writeFileSync(plain, "import { expect, it } from 'bun:test';\nit('works', () => {});\n");

    expect(usesMockModule(mocked)).toBe(true);
    expect(usesMockModule(plain)).toBe(false);
  });

  it('ignores mock.module text inside comments and string literals', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'sentris-test-plan-'));
    const file = path.join(tempDir, 'fixture.test.ts');

    writeFileSync(
      file,
      [
        'const fixture = "mock.module(\'@/store\', () => ({}));";',
        "// mock.module('@/commented', () => ({}));",
      ].join('\n'),
    );

    expect(usesMockModule(file)).toBe(false);
  });

  it('batches adjacent non-mocked files while isolating mock.module files', () => {
    const files = [
      'src/a.test.ts',
      'src/b.test.ts',
      'src/c.test.ts',
      'src/d.test.ts',
      'src/e.test.ts',
    ];

    const runs = planFrontendTestRuns(files, (file) => file === 'src/c.test.ts');

    expect(runs).toEqual([
      {
        label: 'batch 1 (2 files)',
        files: ['src/a.test.ts', 'src/b.test.ts'],
        isolated: false,
      },
      {
        label: 'src/c.test.ts',
        files: ['src/c.test.ts'],
        isolated: true,
      },
      {
        label: 'batch 2 (2 files)',
        files: ['src/d.test.ts', 'src/e.test.ts'],
        isolated: false,
      },
    ]);
  });

  it('applies mock isolation to explicit focused test-file arguments', () => {
    const plan = planExplicitFrontendTestRuns(
      [
        '--test-name-pattern',
        'cursor history',
        'src/plain.test.ts',
        'src/findings.test.tsx',
        'src/target.test.tsx',
      ],
      (file) => file !== 'src/plain.test.ts',
    );

    expect(plan).toEqual({
      passthroughArgs: ['--test-name-pattern', 'cursor history'],
      runs: [
        {
          label: 'batch 1 (1 file)',
          files: ['src/plain.test.ts'],
          isolated: false,
        },
        {
          label: 'src/findings.test.tsx',
          files: ['src/findings.test.tsx'],
          isolated: true,
        },
        {
          label: 'src/target.test.tsx',
          files: ['src/target.test.tsx'],
          isolated: true,
        },
      ],
    });
  });
});
