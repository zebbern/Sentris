#!/usr/bin/env node

/**
 * Compatibility wrapper for stopping the development environment.
 *
 * Usage: node scripts/dev-stop.js
 *        bun run dev:stop
 */

const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const result = spawnSync(process.execPath, [join(__dirname, 'dev.js'), 'stop', ...process.argv.slice(2)], {
  cwd: join(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
