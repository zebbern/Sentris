#!/usr/bin/env node

const { createSecurityComponentsVerifyPlan } = require('./lib/dev-instance-runtime');
const { runPlanScript } = require('./lib/run-command-plan');

process.exit(
  runPlanScript({
    argv: process.argv.slice(2),
    createPlan: createSecurityComponentsVerifyPlan,
    runnerName: 'security components verification runner',
  }),
);
