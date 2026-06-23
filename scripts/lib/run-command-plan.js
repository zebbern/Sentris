const { spawnSync } = require('node:child_process');
const path = require('node:path');

function parseRunnerArgs(argv, runnerName) {
  for (const arg of argv) {
    if (arg !== '--dry-run') {
      throw new Error(`Unknown ${runnerName} option: ${arg}`);
    }
  }

  return {
    dryRun: argv.includes('--dry-run'),
  };
}

function runCommandPlan(plan) {
  for (const step of plan.commands) {
    const displayCwd = step.cwd ? ` (cwd: ${step.cwd})` : '';
    console.log(`$ ${step.command} ${step.args.join(' ')}${displayCwd}`);

    const result = spawnSync(step.command, step.args, {
      cwd: step.cwd ? path.join(process.cwd(), step.cwd) : process.cwd(),
      env: { ...process.env, ...(step.env ?? {}) },
      stdio: 'inherit',
      shell: false,
    });

    if (result.error) {
      console.error(result.error.message);
      return 1;
    }

    const status = result.status ?? 1;
    if (status !== 0) return status;
  }

  return 0;
}

function runPlanScript({ argv, createPlan, runnerName }) {
  let options;
  try {
    options = parseRunnerArgs(argv, runnerName);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const plan = createPlan();
  if (options.dryRun) {
    console.log(JSON.stringify(plan));
    return 0;
  }

  return runCommandPlan(plan);
}

module.exports = {
  parseRunnerArgs,
  runCommandPlan,
  runPlanScript,
};
