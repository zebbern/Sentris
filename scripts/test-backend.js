#!/usr/bin/env node

const path = require('node:path');

const { collectBackendTestFiles, createBackendTestRuns } = require('./lib/backend-test-plan');
const { runCommandStep } = require('./lib/run-command-plan');
const { runTestFilePlan } = require('./lib/test-file-runner');

const TEST_FILE_CONCURRENCY = 3;
const TEST_FILE_TIMEOUT_MS = 120_000;

function createBackendTestStep(run) {
  return {
    command: 'bun',
    args: ['test', '--force-exit', ...run.files],
    cwd: 'backend',
    timeoutMs: TEST_FILE_TIMEOUT_MS,
  };
}

async function main() {
  const repositoryDirectory = path.resolve(__dirname, '..');
  const backendDirectory = path.join(repositoryDirectory, 'backend');
  const args = process.argv.slice(2);

  if (args.length > 0 && !(args.length === 1 && args[0] === '--dry-run')) {
    return runCommandStep(
      {
        command: 'bun',
        args: ['test', '--force-exit', ...args],
        cwd: 'backend',
        timeoutMs: TEST_FILE_TIMEOUT_MS,
      },
      { root: repositoryDirectory },
    );
  }

  const runs = createBackendTestRuns(collectBackendTestFiles(backendDirectory));
  if (args[0] === '--dry-run') {
    console.log(JSON.stringify({ runs }));
    return 0;
  }

  return runTestFilePlan({
    runs,
    concurrency: TEST_FILE_CONCURRENCY,
    root: repositoryDirectory,
    createStep: createBackendTestStep,
  });
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
