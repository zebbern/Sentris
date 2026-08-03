import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const require = createRequire(import.meta.url);
const workerPlan = require('../lib/worker-test-plan.js') as {
  SERIAL_WORKER_TEST_FILES: string[];
  collectWorkerTestFiles: (workerDirectory: string) => string[];
  createWorkerTestRuns: (
    files: string[],
  ) => Array<{ label: string; files: string[]; serial: boolean }>;
};

describe('worker test isolation plan', () => {
  it('runs every worker test exactly once in its own process', () => {
    const workerDirectory = join(process.cwd(), 'worker');
    const files = workerPlan.collectWorkerTestFiles(workerDirectory);
    const runs = workerPlan.createWorkerTestRuns(files);
    const plannedFiles = runs.flatMap((run) => run.files);

    expect([...plannedFiles].sort()).toEqual([...files].sort());
    expect(new Set(plannedFiles).size).toBe(files.length);
    expect(runs).toHaveLength(files.length);
    for (const file of files) {
      expect(runs).toContainEqual({
        label: file,
        files: [file],
        serial: workerPlan.SERIAL_WORKER_TEST_FILES.includes(file),
      });
    }
  });

  it('exposes a non-mutating dry-run for the root runner', () => {
    const result = spawnSync(process.execPath, ['scripts/test-worker.js', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout) as {
      runs: Array<{ files: string[]; serial: boolean }>;
    };
    expect(plan.runs.length).toBeGreaterThan(100);
    expect(plan.runs.every((run) => run.files.length === 1)).toBe(true);
    expect(plan.runs.filter((run) => run.serial)).toHaveLength(
      workerPlan.SERIAL_WORKER_TEST_FILES.length,
    );
  });
});
