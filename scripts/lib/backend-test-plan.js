const path = require('node:path');

const { collectTestFiles } = require('./test-file-runner');

const SERIAL_BACKEND_TEST_PREFIX = 'scripts/migrations/__tests__/';
const SERIAL_BACKEND_TEST_FILES = new Set(['src/database/__tests__/migration.guard.spec.ts']);

function toPosixRelative(root, file) {
  return path.relative(root, file).split(path.sep).join(path.posix.sep);
}

function collectBackendTestFiles(backendDirectory) {
  return collectTestFiles([
    path.join(backendDirectory, 'src'),
    path.join(backendDirectory, 'scripts'),
  ]).map((file) => toPosixRelative(backendDirectory, file));
}

function isSerialBackendTestFile(file) {
  return file.startsWith(SERIAL_BACKEND_TEST_PREFIX) || SERIAL_BACKEND_TEST_FILES.has(file);
}

function createBackendTestRuns(files) {
  if (new Set(files).size !== files.length) {
    throw new Error('Duplicate backend test files are not allowed');
  }

  return files.map((file) => ({
    label: file,
    files: [file],
    serial: isSerialBackendTestFile(file),
  }));
}

module.exports = {
  collectBackendTestFiles,
  createBackendTestRuns,
  isSerialBackendTestFile,
};
