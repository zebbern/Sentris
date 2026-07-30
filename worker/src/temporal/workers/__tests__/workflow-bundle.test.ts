import { expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleWorkflowCode } from '@temporalio/worker';
import { createBundlerOptions } from '../worker-config';

test('keeps the Temporal workflow dependency graph free of Node-only runtime modules', async () => {
  const workflowsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../workflows');

  const bundle = await bundleWorkflowCode({
    workflowsPath,
    ...createBundlerOptions(),
  });

  expect(bundle.code).toContain('sentrisWorkflowRun');
}, 120_000);
