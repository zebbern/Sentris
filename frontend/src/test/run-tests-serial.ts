import { readdirSync } from 'node:fs';
import path from 'node:path';

const TEST_FILE_PATTERN = /\.(test|spec)\.[jt]sx?$/;

function collectTestFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function toPosixRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join(path.posix.sep);
}

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

const cliArgs = process.argv.slice(2);

if (cliArgs.length > 0) {
  process.exit(runBunTest(cliArgs));
}

const srcDir = path.join(process.cwd(), 'src');
const files = collectTestFiles(srcDir)
  .map(toPosixRelative)
  .sort((a, b) => a.localeCompare(b));

for (const file of files) {
  console.log(`\n[frontend:test] ${file}`);
  const exitCode = runBunTest([file]);

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

console.log(`\n[frontend:test] Completed ${files.length} test files serially.`);
