#!/usr/bin/env node

/**
 * Full-stack development startup script.
 * Starts Docker infra + PM2 apps (frontend, backend, worker).
 * Cross-platform (Windows, macOS, Linux) — no bash dependency.
 *
 * Usage: node scripts/dev.js
 *        bun run dev
 */

const { execFileSync, execSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve, join } = require('node:path');
const {
  createDevScriptUsage,
  createDevHealthProbeTargets,
  createPm2AppNames,
  ensureInstanceEnvFiles,
  formatDevHealthProbeResult,
  parseDevScriptArgs,
  probeDevHealthTarget,
  prunePm2DevLogs,
  resolveActiveDevInstance,
  resolvePm2Command,
  shouldStopSharedInfra,
} = require('./lib/dev-instance-runtime');

const ROOT = resolve(__dirname, '..');
const DEV_INSTANCE = resolveActiveDevInstance();

const COMPOSE_FILES = [
  'docker/docker-compose.infra.yml',
  'docker/docker-compose.dev-ports.yml',
];
const COMPOSE_PROJECT = 'sentris';
const PM2_CONFIG = 'pm2.config.cjs';
const PM2_APP_NAMES = createPm2AppNames(DEV_INSTANCE);
const PM2_APPS = PM2_APP_NAMES.join(',');
const PM2_COMMAND = resolvePm2Command({ root: ROOT });

function log(icon, message) {
  console.log(`${icon}  ${message}`);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}

function createDockerComposeArgs(command, extraArgs = []) {
  return [
    'compose',
    ...COMPOSE_FILES.flatMap((file) => ['-f', file]),
    '-p',
    COMPOSE_PROJECT,
    command,
    ...extraArgs,
  ];
}

function checkEnvFiles() {
  const missing = [];
  for (const dir of ['backend', 'worker', 'frontend']) {
    if (!existsSync(join(ROOT, dir, '.env'))) {
      missing.push(`${dir}/.env`);
    }
  }
  if (missing.length > 0) {
    log('✗', 'Missing environment files:');
    for (const f of missing) {
      log('  ', `  - ${f}`);
    }
    console.log('');
    log('  ', 'Run first: bun run setup');
    process.exit(1);
  }
}

function checkDocker() {
  try {
    execSync('docker info', { stdio: 'ignore' });
  } catch {
    log('✗', 'Docker is not running.');
    log('  ', 'Please start Docker Desktop and try again.');
    process.exit(1);
  }
}

function startDockerInfra() {
  log('🐳', 'Starting Docker infrastructure...');
  try {
    execFileSync('docker', createDockerComposeArgs('up', ['-d']), {
      cwd: ROOT,
      stdio: 'inherit',
    });
    log('✓', 'Docker infrastructure started');
  } catch {
    log('✗', 'Failed to start Docker infrastructure.');
    log('  ', 'Check Docker logs for details.');
    process.exit(1);
  }
}

function ensureInstanceEnv() {
  const result = ensureInstanceEnvFiles({ root: ROOT, instance: DEV_INSTANCE });
  const created = result.files.filter((file) => file.created).map((file) => `${file.app}.env`);
  if (created.length > 0) {
    log('✓', `Initialized instance env files: ${created.join(', ')}`);
  } else {
    log('✓', `Verified instance ${DEV_INSTANCE} env files`);
  }
}

function stopPm2Apps() {
  log('🛑', `Stopping instance ${DEV_INSTANCE} applications via ${PM2_COMMAND.displayName}...`);
  try {
    execFileSync(PM2_COMMAND.command, [...PM2_COMMAND.argsPrefix, 'delete', ...PM2_APP_NAMES], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch {
    // Apps may not be running.
  }
  log('✓', 'PM2 applications stopped');
}

function stopDockerInfra({ volumes = false } = {}) {
  log('🐳', volumes ? 'Stopping Docker infrastructure and removing volumes...' : 'Stopping Docker infrastructure...');
  try {
    execFileSync('docker', createDockerComposeArgs('down', volumes ? ['-v'] : []), {
      cwd: ROOT,
      stdio: 'inherit',
    });
    log('✓', volumes ? 'Docker infrastructure cleaned' : 'Docker infrastructure stopped');
  } catch {
    log('⚠', 'Docker infrastructure may not have been running.');
  }
}

async function printRuntimeHealth() {
  log('  ', 'Runtime health:');
  const targets = createDevHealthProbeTargets(DEV_INSTANCE);
  const results = await Promise.all(targets.map((target) => probeDevHealthTarget(target)));
  for (const result of results) {
    log('  ', `  ${formatDevHealthProbeResult(result)}`);
  }
}

async function printStatus() {
  console.log('');
  log('📊', `Sentris Flow status for instance ${DEV_INSTANCE}`);
  console.log('');

  log('  ', 'PM2 services:');
  try {
    execFileSync(PM2_COMMAND.command, [...PM2_COMMAND.argsPrefix, 'status'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch {
    log('  ', '  PM2 status unavailable.');
  }

  console.log('');
  log('  ', 'Docker infrastructure:');
  try {
    execFileSync('docker', createDockerComposeArgs('ps'), {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch {
    log('  ', '  Docker infrastructure status unavailable.');
  }

  console.log('');
  await printRuntimeHealth();
  console.log('');
}

function showLogs() {
  log('📜', `Following instance ${DEV_INSTANCE} application logs...`);
  execFileSync(PM2_COMMAND.command, [...PM2_COMMAND.argsPrefix, 'logs', ...PM2_APP_NAMES], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

function trySetGitSha() {
  // set-git-sha.sh requires bash — skip silently on Windows or if bash is unavailable
  const scriptPath = join(ROOT, 'scripts', 'set-git-sha.sh');
  if (!existsSync(scriptPath)) {
    return;
  }
  try {
    execSync('bash scripts/set-git-sha.sh', { cwd: ROOT, stdio: 'ignore' });
  } catch {
    // Not critical — skip silently
  }
}

function prunePm2Logs() {
  try {
    const result = prunePm2DevLogs({ instance: DEV_INSTANCE });
    const prunedFiles = result.files.filter((file) => file.pruned);

    if (prunedFiles.length > 0) {
      const prunedBytes = prunedFiles.reduce(
        (total, file) => total + Math.max(0, file.beforeBytes - file.afterBytes),
        0,
      );
      log(
        '🧹',
        `Pruned ${prunedFiles.length} PM2 log file(s), reclaimed ${formatBytes(prunedBytes)} (cap ${formatBytes(result.maxBytes)} each)`,
      );
    }
  } catch (error) {
    log('⚠', `Could not prune PM2 logs: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function restartPm2Apps() {
  log('♻️', `Restarting instance ${DEV_INSTANCE} applications via ${PM2_COMMAND.displayName}...`);
  try {
    execFileSync(PM2_COMMAND.command, [...PM2_COMMAND.argsPrefix, 'restart', ...PM2_APP_NAMES], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    log('✓', 'PM2 applications restarted');
  } catch {
    log('⚠', 'Restart failed — apps may not be running. Trying startOrReload...');
    startPm2Apps();
  }
}

function startPm2Apps() {
  log('🚀', `Starting instance ${DEV_INSTANCE} applications via ${PM2_COMMAND.displayName}...`);
  prunePm2Logs();
  try {
    const args = [
      ...PM2_COMMAND.argsPrefix,
      'startOrReload',
      PM2_CONFIG,
      '--only',
      PM2_APPS,
      '--update-env',
    ];
    execFileSync(PM2_COMMAND.command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        SENTRIS_INSTANCE: String(DEV_INSTANCE),
        SENTRIS_ENV: 'development',
        NODE_ENV: 'development',
        OPENSEARCH_SECURITY_ENABLED: 'false',
        OPENSEARCH_URL: 'http://localhost:9200',
      },
    });
    log('✓', 'PM2 applications started');
  } catch {
    log('✗', 'Failed to start PM2 applications.');
    log('  ', 'Run "pm2 logs" to check for errors.');
    process.exit(1);
  }
}

function printSummary() {
  const portOffset = DEV_INSTANCE * 100;
  console.log('');
  log('✅', `Development environment ready for instance ${DEV_INSTANCE}!`);
  console.log('');
  log('  ', 'Services:');
  log('  ', `  Frontend:    http://localhost:${5173 + portOffset}`);
  log('  ', `  Backend:     http://localhost:${3211 + portOffset}`);
  log('  ', '  Temporal UI: http://localhost:8081');
  console.log('');
  log('  ', 'Commands:');
  log('  ', '  bun run dev:stop     — Stop everything');
  log('  ', '  bun run dev restart  — Restart PM2 apps for active instance');
  log('  ', '  bun run pm2 -- status — PM2 via repo-local binary');
  log('  ', '  bun run dev:fe       — Frontend only (no Docker)');
  console.log('');
}

function printDryRun(action) {
  const plan = {
    action,
    instance: DEV_INSTANCE,
    pm2Apps: PM2_APP_NAMES,
    pm2Command: PM2_COMMAND,
    instanceEnvDir: `${ROOT}/.instances/instance-${DEV_INSTANCE}`,
  };

  if (action === 'start') {
    plan.dockerCompose = {
      command: 'docker',
      args: createDockerComposeArgs('up', ['-d']),
    };
  } else if (action === 'status') {
    plan.dockerCompose = {
      command: 'docker',
      args: createDockerComposeArgs('ps'),
    };
  } else if (action === 'stop' || action === 'clean') {
    plan.dockerCompose = {
      command: 'docker',
      args: createDockerComposeArgs('down', action === 'clean' ? ['-v'] : []),
    };
  }

  console.log(JSON.stringify(plan, null, 2));
}

function startFullStack() {
  console.log('');
  log('🔧', `Starting Sentris Flow instance ${DEV_INSTANCE} (full stack)...`);
  console.log('');

  checkEnvFiles();
  ensureInstanceEnv();
  checkDocker();
  startDockerInfra();
  console.log('');
  trySetGitSha();
  startPm2Apps();
  printSummary();
}

function stopFullStack({ clean = false } = {}) {
  console.log('');
  log('🔧', `${clean ? 'Cleaning' : 'Stopping'} Sentris Flow instance ${DEV_INSTANCE}...`);
  console.log('');

  stopPm2Apps();
  if (clean) {
    prunePm2Logs();
  }
  console.log('');
  if (shouldStopSharedInfra(DEV_INSTANCE)) {
    stopDockerInfra({ volumes: clean });
  } else {
    log('↪', 'Leaving shared Docker infrastructure running for other instances.');
  }

  console.log('');
  log('✅', `${clean ? 'Cleaned' : 'Stopped'} Sentris Flow instance ${DEV_INSTANCE}.`);
  console.log('');
}

async function main() {
  let command;
  try {
    command = parseDevScriptArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (command.action === 'help') {
    console.log(createDevScriptUsage());
    return;
  }

  if (command.dryRun) {
    printDryRun(command.action);
    return;
  }

  switch (command.action) {
    case 'start':
      startFullStack();
      return;
    case 'status':
      await printStatus();
      return;
    case 'logs':
      showLogs();
      return;
    case 'stop':
      stopFullStack();
      return;
    case 'restart':
      restartPm2Apps();
      return;
    case 'clean':
      stopFullStack({ clean: true });
      return;
    default:
      console.error(createDevScriptUsage());
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
