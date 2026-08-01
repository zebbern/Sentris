import { resolve } from 'node:path';

import { buildBackendEntrypoint } from './build-app';

const backendRoot = resolve(import.meta.dir, '..');
const bundlePath = await buildBackendEntrypoint({
  entrypoint: 'scripts/generate-openapi.runtime.ts',
  outdir: 'build/openapi',
});
const child = Bun.spawn([process.execPath, bundlePath], {
  cwd: backendRoot,
  env: {
    ...process.env,
    SENTRIS_OPENAPI_OUTPUT: resolve(backendRoot, '..', 'openapi.json'),
  },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
const exitCode = await child.exited;
if (exitCode !== 0) throw new Error(`OpenAPI generator exited with code ${exitCode}`);
