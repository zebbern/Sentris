#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const { createRootTestPlan, resolveActiveDevInstance } = require('./lib/dev-instance-runtime');
const { parseRunnerArgs, runCommandPlan } = require('./lib/run-command-plan');

function parseArgs(argv) {
  return parseRunnerArgs(argv, 'root test runner');
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const instance = resolveActiveDevInstance();
  const plan = createRootTestPlan({ instance });

  if (options.dryRun) {
    console.log(JSON.stringify(plan));
    return 0;
  }

  for (const relativePath of plan.cleanupPaths) {
    fs.rmSync(path.join(process.cwd(), relativePath), { recursive: true, force: true });
  }

  return runCommandPlan(plan);
}

process.exit(main());
