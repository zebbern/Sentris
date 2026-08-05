const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_PROGRESS_INTERVAL_MS = 30_000;
const TIMEOUT_EXIT_CODE = 124;

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

function isProcessAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resolveCommandExecutable(command, options = {}) {
  if (command !== 'bun') return command;

  const bunExecutable = Object.hasOwn(options, 'bunExecutable')
    ? options.bunExecutable
    : typeof Bun === 'undefined'
      ? undefined
      : process.execPath;
  if (bunExecutable) return bunExecutable;

  const packageExecutable = (options.env ?? process.env).npm_execpath;
  if (packageExecutable && /^bun(?:\.exe)?$/i.test(path.basename(packageExecutable))) {
    return packageExecutable;
  }

  return command;
}

async function terminateProcessTree(processId, options = {}) {
  if (!Number.isInteger(processId) || processId <= 0) return;
  const platform = options.platform ?? process.platform;

  if (platform === 'win32') {
    const result = (options.spawnSync ?? spawnSync)(
      'taskkill.exe',
      ['/pid', String(processId), '/t', '/f'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0 && isProcessAlive(processId)) {
      throw new Error(`taskkill exited with status ${result.status ?? 'unknown'}`);
    }
    return;
  }

  const kill = options.kill ?? process.kill.bind(process);
  const killGroup = (signal) => {
    try {
      kill(-processId, signal);
      return true;
    } catch {
      try {
        kill(processId, signal);
        return true;
      } catch {
        return false;
      }
    }
  };

  if (!killGroup('SIGTERM')) return;
  await (options.delay ?? delay)(options.gracePeriodMs ?? 500);
  if (isProcessAlive(processId)) killGroup('SIGKILL');
}

function runCommandStep(step, options = {}) {
  const root = options.root ?? process.cwd();
  const timeoutMs = step.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const progressIntervalMs =
    step.progressIntervalMs ?? options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  const displayCwd = step.cwd ? ` (cwd: ${step.cwd})` : '';
  console.log(`$ ${step.command} ${step.args.join(' ')}${displayCwd}`);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(resolveCommandExecutable(step.command), step.args, {
      cwd: step.cwd ? path.join(root, step.cwd) : root,
      env: { ...process.env, ...(step.env ?? {}) },
      stdio: 'inherit',
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    let settled = false;
    let timeout;
    let progress;

    const signalHandlers = new Map();
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (progress) clearInterval(progress);
      for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    };
    const finish = (status) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(status);
    };
    const stop = async (status, message) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (message) console.error(message);
      try {
        await terminateProcessTree(child.pid);
        resolve(status);
      } catch (error) {
        console.error(
          `[runner] Failed to terminate the command tree: ${error instanceof Error ? error.message : String(error)}`,
        );
        resolve(1);
      }
    };

    child.once('error', (error) => {
      console.error(error.message);
      finish(1);
    });
    child.once('exit', (code) => finish(code ?? 1));

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        void stop(
          TIMEOUT_EXIT_CODE,
          `[runner] Timed out after ${Math.ceil(timeoutMs / 1000)}s; terminating the command tree.`,
        );
      }, timeoutMs);
    }
    if (progressIntervalMs > 0) {
      progress = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
        console.log(`[runner] Still running after ${elapsedSeconds}s: ${step.command}`);
      }, progressIntervalMs);
    }

    for (const [signal, status] of [
      ['SIGHUP', 129],
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ]) {
      const handler = () => {
        void stop(status, `[runner] Received ${signal}; terminating the command tree.`);
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
  });
}

async function runCommandPlan(plan, options = {}) {
  for (const step of plan.commands) {
    const status = await runCommandStep(step, options);
    if (status !== 0) return status;
  }

  return 0;
}

async function runPlanScript({ argv, createPlan, runnerName }) {
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
  DEFAULT_COMMAND_TIMEOUT_MS,
  parseRunnerArgs,
  resolveCommandExecutable,
  runCommandPlan,
  runCommandStep,
  runPlanScript,
  terminateProcessTree,
};
