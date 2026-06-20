import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';

const TEST_FILE_PATTERN = /\.(test|spec)\.[jt]sx?$/;

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

function getScriptKind(filePath: string): ts.ScriptKind {
  switch (path.extname(filePath).toLowerCase()) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

export function usesMockModule(filePath: string): boolean {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    getScriptKind(filePath),
  );

  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'mock' &&
      node.expression.name.text === 'module'
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
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
