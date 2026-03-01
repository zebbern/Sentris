#!/usr/bin/env node

/**
 * First-time project setup script.
 * Cross-platform (Windows, macOS, Linux) — no bash dependency.
 *
 * Usage: node scripts/setup.js
 *        bun run setup
 */

const { execSync } = require('node:child_process');
const { existsSync, copyFileSync } = require('node:fs');
const { resolve, join } = require('node:path');

const ROOT = resolve(__dirname, '..');

const ENV_FILES = [
  { name: 'backend', example: 'backend/.env.example', target: 'backend/.env' },
  { name: 'worker', example: 'worker/.env.example', target: 'worker/.env' },
  { name: 'frontend', example: 'frontend/.env.example', target: 'frontend/.env' },
];

function log(icon, message) {
  console.log(`${icon}  ${message}`);
}

function installDependencies() {
  const nodeModulesPath = join(ROOT, 'node_modules');
  if (existsSync(nodeModulesPath)) {
    log('✓', 'Dependencies already installed');
    return;
  }

  log('📦', 'Installing dependencies...');
  try {
    execSync('bun install', { cwd: ROOT, stdio: 'inherit' });
    log('✓', 'Dependencies installed');
  } catch {
    log('✗', 'Failed to install dependencies. Is bun installed?');
    log('  ', 'Install bun: https://bun.sh/docs/installation');
    process.exit(1);
  }
}

function copyEnvFiles() {
  let copied = 0;
  let skipped = 0;

  for (const { name, example, target } of ENV_FILES) {
    const examplePath = join(ROOT, example);
    const targetPath = join(ROOT, target);

    if (existsSync(targetPath)) {
      log('✓', `${name}/.env already exists (skipped)`);
      skipped++;
      continue;
    }

    if (!existsSync(examplePath)) {
      log('⚠', `${example} not found — skipping ${name}`);
      continue;
    }

    copyFileSync(examplePath, targetPath);
    log('✓', `Created ${target} from ${example}`);
    copied++;
  }

  return { copied, skipped };
}

function main() {
  console.log('');
  log('🔧', 'Setting up Sentris Flow...');
  console.log('');

  installDependencies();
  console.log('');

  const { copied, skipped } = copyEnvFiles();
  console.log('');

  log('🎉', 'Setup complete!');
  console.log('');

  if (copied > 0) {
    log('  ', 'Edit the .env files to configure your environment.');
  }
  if (skipped > 0 && copied === 0) {
    log('  ', 'All .env files already exist — no changes made.');
  }

  console.log('');
  log('  ', 'Next steps:');
  log('  ', '  1. Start Docker Desktop (if not running)');
  log('  ', '  2. Run: bun run dev');
  console.log('');
}

main();
