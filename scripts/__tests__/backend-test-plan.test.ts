import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const require = createRequire(import.meta.url);
const backendPlan = require('../lib/backend-test-plan.js') as {
  collectBackendTestFiles: (backendDirectory: string) => string[];
  createBackendTestRuns: (
    files: string[],
  ) => Array<{ label: string; files: string[]; serial: boolean }>;
  isSerialBackendTestFile: (file: string) => boolean;
};

describe('backend test isolation plan', () => {
  it('discovers every backend test exactly once across source and scripts', () => {
    const backendDirectory = join(process.cwd(), 'backend');
    const files = backendPlan.collectBackendTestFiles(backendDirectory);

    expect(files).toHaveLength(231);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toEqual([...files].sort((left, right) => left.localeCompare(right)));
    expect(files.some((file) => file.startsWith('src/'))).toBe(true);
    expect(files.some((file) => file.startsWith('scripts/'))).toBe(true);
    expect(files.every((file) => !file.includes('\\'))).toBe(true);
  });

  it('runs one file per process and serializes migration catalog readers', () => {
    const files = [
      'src/auth/__tests__/auth.service.spec.ts',
      'src/database/__tests__/migration.guard.spec.ts',
      'scripts/migrations/__tests__/checked-migrations.test.ts',
    ];

    expect(backendPlan.createBackendTestRuns(files)).toEqual([
      {
        label: files[0],
        files: [files[0]],
        serial: false,
      },
      {
        label: files[1],
        files: [files[1]],
        serial: true,
      },
      {
        label: files[2],
        files: [files[2]],
        serial: true,
      },
    ]);
  });

  it('rejects duplicate planned paths', () => {
    expect(() =>
      backendPlan.createBackendTestRuns([
        'src/example/__tests__/example.test.ts',
        'src/example/__tests__/example.test.ts',
      ]),
    ).toThrow('Duplicate backend test files');
  });
});
