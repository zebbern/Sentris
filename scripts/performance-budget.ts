/* eslint-disable no-console -- Release-gate CLI reports a bounded comparison table. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  comparePerformanceArtifacts,
  type PerformanceArtifact,
} from './lib/performance-budget';

interface CliOptions {
  baselinePath: string;
  candidatePath: string;
  budgetPercent: number;
}

export function parsePerformanceBudgetArgs(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || !value) {
      throw new Error(
        'Usage: bun scripts/performance-budget.ts --baseline <file> --candidate <file> [--budget 10]',
      );
    }
    values.set(flag, value);
  }

  const baselinePath = values.get('--baseline');
  const candidatePath = values.get('--candidate');
  const budgetPercent = Number(values.get('--budget') ?? '10');
  if (!baselinePath || !candidatePath || !Number.isFinite(budgetPercent) || budgetPercent <= 0) {
    throw new Error(
      'Usage: bun scripts/performance-budget.ts --baseline <file> --candidate <file> [--budget 10]',
    );
  }
  for (const flag of values.keys()) {
    if (!['--baseline', '--candidate', '--budget'].includes(flag)) {
      throw new Error(`Unknown performance-budget option ${flag}`);
    }
  }

  return { baselinePath, candidatePath, budgetPercent };
}

async function readArtifact(path: string): Promise<PerformanceArtifact> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as PerformanceArtifact;
}

async function main(): Promise<void> {
  const options = parsePerformanceBudgetArgs(process.argv.slice(2));
  const results = comparePerformanceArtifacts(
    await readArtifact(options.baselinePath),
    await readArtifact(options.candidatePath),
    options.budgetPercent,
  );

  console.table(
    results.map((result) => ({
      Metric: result.metric,
      Baseline: result.baseline,
      Candidate: result.candidate,
      'Regression %': result.regressionPercent.toFixed(2),
      'Budget %': result.budgetPercent.toFixed(2),
      Result: result.passed ? 'PASS' : 'FAIL',
    })),
  );

  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    throw new Error(
      `Performance budget exceeded: ${failed
        .map((result) => `${result.metric} (${result.regressionPercent.toFixed(2)}%)`)
        .join(', ')}`,
    );
  }
  console.log(`All ${results.length} release metrics are within the performance budget.`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
