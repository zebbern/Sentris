#!/usr/bin/env node

/**
 * Stop full-stack development environment.
 * Stops PM2 apps and Docker infra.
 * Cross-platform (Windows, macOS, Linux) — no bash dependency.
 *
 * Usage: node scripts/dev-stop.js
 *        bun run dev:stop
 */

const { execSync } = require('node:child_process');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');

const COMPOSE_FILES = [
  'docker/docker-compose.infra.yml',
  'docker/docker-compose.dev-ports.yml',
];
const COMPOSE_PROJECT = 'sentris';
const PM2_APPS = [
  'sentris-frontend-0',
  'sentris-backend-0',
  'sentris-worker-0',
];

function log(icon, message) {
  console.log(`${icon}  ${message}`);
}

function stopPm2Apps() {
  log('🛑', 'Stopping PM2 applications...');
  try {
    execSync(`pm2 delete ${PM2_APPS.join(' ')}`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch {
    // Apps may not be running — that's fine
  }
  log('✓', 'PM2 applications stopped');
}

function stopDockerInfra() {
  const composeArgs = COMPOSE_FILES.map((f) => `-f ${f}`).join(' ');
  const cmd = `docker compose ${composeArgs} -p ${COMPOSE_PROJECT} down`;

  log('🐳', 'Stopping Docker infrastructure...');
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    log('✓', 'Docker infrastructure stopped');
  } catch {
    log('⚠', 'Docker infrastructure may not have been running.');
  }
}

function main() {
  console.log('');
  log('🔧', 'Stopping Sentris Flow...');
  console.log('');

  stopPm2Apps();
  console.log('');
  stopDockerInfra();

  console.log('');
  log('✅', 'Development environment stopped.');
  console.log('');
}

main();
