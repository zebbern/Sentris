import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serializeRuntimeConfig } from '../config/runtime-config';

const outputPath = resolve(import.meta.dir, '..', '..', 'dist', 'runtime-config.js');

export function writeRuntimeConfigFile(
  targetPath: string,
  source: Record<string, string | undefined>,
): void {
  writeFileSync(targetPath, serializeRuntimeConfig(source), { encoding: 'utf8' });
}

if (import.meta.main) {
  writeRuntimeConfigFile(outputPath, process.env);
  console.log(`Frontend runtime config generated at ${outputPath}`);
}
