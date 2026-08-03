const { readdirSync } = require('node:fs');
const path = require('node:path');

const TEST_FILE_PATTERN = /\.(test|spec)\.[jt]sx?$/;
const SERIAL_WORKER_TEST_FILES = [
  'src/mcp-runtime/__tests__/mcp-client-conformance.spec.ts',
  'src/mcp-runtime/__tests__/mcp-runtime-drivers.spec.ts',
  'src/temporal/workers/__tests__/workflow-bundle.test.ts',
  'src/temporal/workflows/__tests__/mcp-operation-update-replay.test.ts',
];

function collectTestFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectWorkerTestFiles(workerDirectory) {
  return collectTestFiles(path.join(workerDirectory, 'src')).map((file) =>
    path.relative(workerDirectory, file).split(path.sep).join(path.posix.sep),
  );
}

function createWorkerTestRuns(files) {
  const fileSet = new Set(files);
  const missingSerialFiles = SERIAL_WORKER_TEST_FILES.filter((file) => !fileSet.has(file));
  if (missingSerialFiles.length > 0) {
    throw new Error(`Missing serial worker tests: ${missingSerialFiles.join(', ')}`);
  }

  const serialFiles = new Set(SERIAL_WORKER_TEST_FILES);
  return files.map((file) => ({ label: file, files: [file], serial: serialFiles.has(file) }));
}

module.exports = {
  SERIAL_WORKER_TEST_FILES,
  collectWorkerTestFiles,
  createWorkerTestRuns,
};
