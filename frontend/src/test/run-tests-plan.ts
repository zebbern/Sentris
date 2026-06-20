import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const TEST_FILE_PATTERN = /\.(test|spec)\.[jt]sx?$/;
const MOCK_MODULE_PATTERN = /\bmock\.module\s*\(/;

export interface FrontendTestRun {
  label: string;
  files: string[];
  isolated: boolean;
}

export function collectTestFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
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

export function toPosixRelative(filePath: string, cwd = process.cwd()): string {
  return path.relative(cwd, filePath).split(path.sep).join(path.posix.sep);
}

export function usesMockModule(filePath: string): boolean {
  return MOCK_MODULE_PATTERN.test(readFileSync(filePath, 'utf8'));
}

export function planFrontendTestRuns(
  files: string[],
  isIsolatedFile: (file: string) => boolean,
): FrontendTestRun[] {
  const runs: FrontendTestRun[] = [];
  let batch: string[] = [];
  let batchCount = 0;

  const flushBatch = () => {
    if (batch.length === 0) return;
    batchCount += 1;
    runs.push({
      label: `batch ${batchCount} (${batch.length} ${batch.length === 1 ? 'file' : 'files'})`,
      files: batch,
      isolated: false,
    });
    batch = [];
  };

  for (const file of files) {
    if (isIsolatedFile(file)) {
      flushBatch();
      runs.push({ label: file, files: [file], isolated: true });
      continue;
    }

    batch.push(file);
  }

  flushBatch();
  return runs;
}
