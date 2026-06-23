#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const {
  createE2eTestCommand,
  readE2eEnvFile,
  resolveActiveE2eInstance,
} = require('./lib/dev-instance-runtime');

function parseArgs(argv) {
  const targets = [];
  const extraArgs = [];
  let cloud = false;
  let dryRun = false;
  let afterSeparator = false;

  for (const arg of argv) {
    if (arg === '--') {
      afterSeparator = true;
      continue;
    }
    if (!afterSeparator && arg === '--cloud') {
      cloud = true;
      continue;
    }
    if (!afterSeparator && arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!afterSeparator && arg.startsWith('--')) {
      throw new Error(`Unknown E2E runner option: ${arg}`);
    }

    if (targets.length === 0 && !afterSeparator) {
      targets.push(arg);
    } else {
      extraArgs.push(arg);
    }
  }

  return {
    cloud,
    dryRun,
    targets: targets.length > 0 ? targets : ['e2e-tests'],
    extraArgs,
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const instance = resolveActiveE2eInstance();
  const command = createE2eTestCommand({
    instance,
    targets: options.targets,
    extraArgs: options.extraArgs,
    cloud: options.cloud,
  });
  const loadedEnv = readE2eEnvFile();
  const env = { ...(loadedEnv?.values ?? {}), ...process.env, ...command.env };

  console.log(
    `Running E2E tests for instance ${instance}: ${command.command} ${command.args.join(' ')}`,
  );

  if (options.dryRun) {
    console.log(
      JSON.stringify({
        command: command.command,
        args: command.args,
        env: command.env,
        ...(loadedEnv
          ? {
              loadedEnvFile: loadedEnv.filePath,
              loadedEnvKeys: Object.keys(loadedEnv.values).sort(),
            }
          : {}),
      }),
    );
    return 0;
  }

  const result = spawnSync(command.command, command.args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

process.exit(main());
