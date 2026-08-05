const { readdirSync } = require('node:fs');
const path = require('node:path');

const { runCommandStep } = require('./run-command-plan');

const TEST_FILE_PATTERN = /\.(test|spec)\.[jt]sx?$/;

function collectDirectoryTestFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDirectoryTestFiles(fullPath));
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectTestFiles(directories) {
  return directories
    .flatMap(collectDirectoryTestFiles)
    .sort((left, right) => left.localeCompare(right));
}

async function runTestFilePlan(options) {
  const {
    runs,
    createStep,
    root = process.cwd(),
    concurrency = 3,
    runStep = runCommandStep,
  } = options;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Test-file concurrency must be a positive integer');
  }

  const ordinaryRuns = runs.filter((run) => !run.serial);
  const serialRuns = runs.filter((run) => run.serial);
  let nextRunIndex = 0;
  let failureStatus = 0;

  async function runOrdinaryWorker() {
    while (failureStatus === 0 && nextRunIndex < ordinaryRuns.length) {
      const run = ordinaryRuns[nextRunIndex];
      nextRunIndex += 1;
      const status = await runStep(createStep(run), { root });
      if (status !== 0 && failureStatus === 0) failureStatus = status;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ordinaryRuns.length) }, runOrdinaryWorker),
  );
  if (failureStatus !== 0) return failureStatus;

  for (const run of serialRuns) {
    const status = await runStep(createStep(run), { root });
    if (status !== 0) return status;
  }

  return 0;
}

module.exports = {
  collectTestFiles,
  runTestFilePlan,
};
