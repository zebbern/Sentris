import path from 'node:path';

import {
  collectTestFiles,
  planFrontendTestRuns,
  toPosixRelative,
  usesMockModule,
} from './run-tests-plan';

function runBunTest(args: string[]): number {
  const result = Bun.spawnSync(
    [process.execPath, 'test', '--preload', './src/test/setup.ts', '--max-concurrency=1', ...args],
    {
      cwd: process.cwd(),
      env: process.env,
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    },
  );

  return result.exitCode ?? 1;
}

function main(): number {
  const cliArgs = process.argv.slice(2);

  if (cliArgs.length > 0) {
    return runBunTest(cliArgs);
  }

  const srcDir = path.join(process.cwd(), 'src');
  const files = collectTestFiles(srcDir).map((file) => toPosixRelative(file));
  const runs = planFrontendTestRuns(files, (file) => usesMockModule(path.resolve(file)));

  for (const run of runs) {
    console.log(`\n[frontend:test] ${run.isolated ? 'isolated' : 'batch'}: ${run.label}`);
    const exitCode = runBunTest(run.files);

    if (exitCode !== 0) {
      return exitCode;
    }
  }

  const isolatedCount = runs.filter((run) => run.isolated).length;
  const batchedCount = files.length - isolatedCount;
  console.log(
    `\n[frontend:test] Completed ${files.length} test files in ${runs.length} processes (${batchedCount} batched, ${isolatedCount} isolated).`,
  );
  return 0;
}

process.exit(main());
