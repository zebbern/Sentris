#!/usr/bin/env node

const { createTemplateLibraryVerifyPlan } = require('./lib/dev-instance-runtime');
const { runPlanScript } = require('./lib/run-command-plan');

process.exit(
  runPlanScript({
    argv: process.argv.slice(2),
    createPlan: createTemplateLibraryVerifyPlan,
    runnerName: 'template library verification runner',
  }),
);
