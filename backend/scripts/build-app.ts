import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const BACKEND_ROOT = resolve(import.meta.dir, '..');
const BUNDLE_EXTERNALS = [
  '@temporalio/client',
  '@nestjs/websockets/socket-module',
  'nats',
  '@nestjs/mongoose',
  '@mikro-orm/core',
  '@nestjs/typeorm/dist/common/typeorm.utils',
  '@nestjs/sequelize/dist/common/sequelize.utils',
  'class-transformer/storage',
] as const;

export async function buildBackendEntrypoint(options: {
  entrypoint: string;
  outdir: string;
}): Promise<string> {
  const entrypoint = resolve(BACKEND_ROOT, options.entrypoint);
  const outdir = resolve(BACKEND_ROOT, options.outdir);
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir,
    target: 'bun',
    // Application sources need Bun's legacy decorator transform for Nest metadata.
    // Keep Temporal's client external so its gRPC/timer internals execute exactly as
    // the maintained package ships them. Other dependencies remain bundled because
    // the backend intentionally registers worker components whose dependencies are
    // installed under the worker workspace rather than the backend workspace.
    external: [...BUNDLE_EXTERNALS],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Backend bundle failed for ${options.entrypoint}`);
  }

  const templateTarget = resolve(outdir, 'templates');
  await rm(templateTarget, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await cp(resolve(BACKEND_ROOT, 'src/mcp-groups/templates'), templateTarget, {
    recursive: true,
  });

  const output = result.outputs.find((artifact) => artifact.kind === 'entry-point');
  if (!output) throw new Error(`Backend bundle produced no entry point for ${options.entrypoint}`);
  return output.path;
}

if (import.meta.main) {
  await buildBackendEntrypoint({ entrypoint: 'src/main.ts', outdir: 'build' });
}
