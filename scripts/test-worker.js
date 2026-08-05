#!/usr/bin/env node

const path = require('node:path');

const { parseRunnerArgs } = require('./lib/run-command-plan');
const { runTestFilePlan } = require('./lib/test-file-runner');
const { collectWorkerTestFiles, createWorkerTestRuns } = require('./lib/worker-test-plan');

const TEST_FILE_CONCURRENCY = 3;

function createWorkerTestStep(run) {
  const bunExecutable = typeof Bun === 'undefined' ? 'bun' : process.execPath;
  const testFiles = run.files.map((file) => path.posix.join('worker', file));
  return {
    command: bunExecutable,
    args: ['test', ...testFiles],
    timeoutMs: 180_000,
  };
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

  return runTestFilePlan({
    runs,
    concurrency: TEST_FILE_CONCURRENCY,
    root: repositoryDirectory,
    createStep: createWorkerTestStep,
  });
}

main().then((code) => process.exit(code));
