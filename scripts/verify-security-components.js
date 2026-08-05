#!/usr/bin/env node

const { createSecurityComponentsVerifyPlan } = require('./lib/dev-instance-runtime');
const { runPlanScript } = require('./lib/run-command-plan');

runPlanScript({
  argv: process.argv.slice(2),
  createPlan: createSecurityComponentsVerifyPlan,
  runnerName: 'security components verification runner',
}).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
