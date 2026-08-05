#!/usr/bin/env node

const { createTemplateLibraryVerifyPlan } = require('./lib/dev-instance-runtime');
const { runPlanScript } = require('./lib/run-command-plan');

runPlanScript({
  argv: process.argv.slice(2),
  createPlan: createTemplateLibraryVerifyPlan,
  runnerName: 'template library verification runner',
}).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
