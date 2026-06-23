#!/usr/bin/env node

/**
 * Run PM2 using the repo-local binary when available.
 * Usage: bun run pm2 -- status
 *        bun run pm2 -- restart sentris-backend-0 sentris-worker-0
 */

const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const { resolvePm2Command } = require('./lib/dev-instance-runtime');

const ROOT = resolve(__dirname, '..');
const pm2Args = process.argv.slice(2);

if (pm2Args.length === 0 || pm2Args[0] === '--help' || pm2Args[0] === '-h') {
  console.log('Usage: bun run pm2 -- <pm2-args>');
  console.log('Example: bun run pm2 -- status');
  process.exit(pm2Args.length === 0 ? 1 : 0);
}

const PM2_COMMAND = resolvePm2Command({ root: ROOT });

execFileSync(PM2_COMMAND.command, [...PM2_COMMAND.argsPrefix, ...pm2Args], {
  cwd: ROOT,
  stdio: 'inherit',
});
