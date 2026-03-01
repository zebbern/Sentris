#!/usr/bin/env node

/**
 * Full-stack development startup script.
 * Starts Docker infra + PM2 apps (frontend, backend, worker).
 * Cross-platform (Windows, macOS, Linux) — no bash dependency.
 *
 * Usage: node scripts/dev.js
 *        bun run dev
 */

const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve, join } = require('node:path');

const ROOT = resolve(__dirname, '..');

const COMPOSE_FILES = [
  'docker/docker-compose.infra.yml',
  'docker/docker-compose.dev-ports.yml',
];
const COMPOSE_PROJECT = 'sentris';
const PM2_CONFIG = 'pm2.config.cjs';
const PM2_APPS = 'sentris-frontend-0,sentris-backend-0,sentris-worker-0';

function log(icon, message) {
  console.log(`${icon}  ${message}`);
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
  const composeArgs = COMPOSE_FILES.map((f) => `-f ${f}`).join(' ');
  const cmd = `docker compose ${composeArgs} -p ${COMPOSE_PROJECT} up -d`;

  log('🐳', 'Starting Docker infrastructure...');
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    log('✓', 'Docker infrastructure started');
  } catch {
    log('✗', 'Failed to start Docker infrastructure.');
    log('  ', 'Check Docker logs for details.');
    process.exit(1);
  }
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

function startPm2Apps() {
  log('🚀', 'Starting applications via PM2...');
  try {
    const cmd = [
      'pm2 startOrReload',
      PM2_CONFIG,
      '--only',
      PM2_APPS,
      '--update-env',
    ].join(' ');
    execSync(cmd, {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        SENTRIS_INSTANCE: '0',
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
  console.log('');
  log('✅', 'Development environment ready!');
  console.log('');
  log('  ', 'Services:');
  log('  ', '  Frontend:    http://localhost:5173');
  log('  ', '  Backend:     http://localhost:3211');
  log('  ', '  Temporal UI: http://localhost:8081');
  console.log('');
  log('  ', 'Commands:');
  log('  ', '  bun run dev:stop   — Stop everything');
  log('  ', '  bun run dev:fe     — Frontend only (no Docker)');
  log('  ', '  pm2 logs           — View application logs');
  log('  ', '  pm2 status         — Check process status');
  console.log('');
}

function main() {
  console.log('');
  log('🔧', 'Starting Sentris Flow (full stack)...');
  console.log('');

  checkEnvFiles();
  checkDocker();
  startDockerInfra();
  console.log('');
  trySetGitSha();
  startPm2Apps();
  printSummary();
}

main();
