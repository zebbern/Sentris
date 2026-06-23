#!/usr/bin/env node

const { resolveActiveDevInstance, writeActiveInstanceFile } = require('./lib/dev-instance-runtime');

function usage() {
  return ['Usage:', '  node scripts/active-instance.js show', '  node scripts/active-instance.js use <0-9>'].join(
    '\n',
  );
}

function main(argv) {
  const [command = 'show', value, extra] = argv;
  if (extra) {
    throw new Error(`Unexpected argument: ${extra}\n${usage()}`);
  }

  switch (command) {
    case 'get':
    case 'show':
      console.log(resolveActiveDevInstance());
      return;
    case 'set':
    case 'use': {
      if (!value) {
        throw new Error(`Missing instance number.\n${usage()}`);
      }
      const instance = writeActiveInstanceFile(value);
      console.log(`Active instance set to ${instance}`);
      return;
    }
    case 'help':
    case '--help':
    case '-h':
      console.log(usage());
      return;
    default:
      throw new Error(`Unknown command: ${command}\n${usage()}`);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
