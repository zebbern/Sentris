#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

const { parseRunnerArgs } = require('./lib/run-command-plan');
const { collectWorkerTestFiles, createWorkerTestRuns } = require('./lib/worker-test-plan');

const TEST_FILE_CONCURRENCY = 3;

function runWorkerTest(run, repositoryDirectory) {
  const bunExecutable = typeof Bun === 'undefined' ? 'bun' : process.execPath;
  const testFiles = run.files.map((file) => path.posix.join('worker', file));
  console.log(`$ bun test ${testFiles.join(' ')} (${run.label})`);
  return new Promise((resolve) => {
    const child = spawn(bunExecutable, ['test', ...testFiles], {
      cwd: repositoryDirectory,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', (error) => {
      console.error(`${run.label}: ${error.message}`);
      resolve(1);
    });
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function runConcurrentTestFiles(runs, repositoryDirectory) {
  let nextRunIndex = 0;
  let failed = false;
  async function runTestFileWorker() {
    while (!failed && nextRunIndex < runs.length) {
      const run = runs[nextRunIndex];
      nextRunIndex += 1;
      if ((await runWorkerTest(run, repositoryDirectory)) !== 0) {
        failed = true;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(TEST_FILE_CONCURRENCY, runs.length) }, runTestFileWorker),
  );
  return failed ? 1 : 0;
}

async function main() {
  let options;
  try {
    options = parseRunnerArgs(process.argv.slice(2), 'worker test runner');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const repositoryDirectory = process.cwd();
  const workerDirectory = path.join(repositoryDirectory, 'worker');
  const runs = createWorkerTestRuns(collectWorkerTestFiles(workerDirectory));
  if (options.dryRun) {
    console.log(JSON.stringify({ runs }));
    return 0;
  }

  const concurrentRuns = runs.filter((run) => !run.serial);
  const serialRuns = runs.filter((run) => run.serial);
  const concurrentResult = await runConcurrentTestFiles(concurrentRuns, repositoryDirectory);
  if (concurrentResult !== 0) return concurrentResult;

  for (const run of serialRuns) {
    const result = await runWorkerTest(run, repositoryDirectory);
    if (result !== 0) return result;
  }
  return 0;
}

main().then((code) => process.exit(code));
