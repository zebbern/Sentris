/* eslint-disable no-console -- This generation command reports sealed artifact changes. */
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import {
  createMigrationArtifactManifest,
  loadMigrationPlan,
  validateMigrationManifestImmutablePrefix,
  type MigrationArtifactManifest,
} from '../src/database/migrations/checked-migrations';

export interface ExecuteCheckedMigrationGenerationOptions {
  args: string[];
  migrationsDir?: string;
  loadCurrentManifest?: (migrationsDir: string) => MigrationArtifactManifest;
  run?: (input: { command: string[] }) => Promise<number>;
  createCandidateManifest?: (migrationsDir: string) => MigrationArtifactManifest;
  writeManifest?: (migrationsDir: string, manifest: MigrationArtifactManifest) => void;
  log?: (message: string) => void;
}

function readManifest(migrationsDir: string): MigrationArtifactManifest {
  loadMigrationPlan(migrationsDir);
  return JSON.parse(
    readFileSync(join(migrationsDir, 'manifest.json'), 'utf8'),
  ) as MigrationArtifactManifest;
}

function createManifestFromDirectory(migrationsDir: string): MigrationArtifactManifest {
  const metaDir = join(migrationsDir, 'meta');
  const journal = JSON.parse(readFileSync(join(metaDir, '_journal.json'), 'utf8')) as unknown;
  const sqlFiles = new Map<string, Uint8Array>();
  for (const entry of readdirSync(migrationsDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile() && entry.name.endsWith('.sql')) {
      const absolutePath = join(entry.parentPath, entry.name);
      sqlFiles.set(
        relative(migrationsDir, absolutePath).replaceAll('\\', '/'),
        readFileSync(absolutePath),
      );
    }
  }
  const snapshots = new Map<string, unknown>();
  for (const entry of readdirSync(metaDir, { withFileTypes: true })) {
    if (entry.isFile() && /^\d{4}_snapshot\.json$/.test(entry.name)) {
      snapshots.set(
        entry.name,
        JSON.parse(readFileSync(join(metaDir, entry.name), 'utf8')) as unknown,
      );
    }
  }
  return createMigrationArtifactManifest({ journal, sqlFiles, snapshots });
}

function writeManifestFile(migrationsDir: string, manifest: MigrationArtifactManifest): void {
  writeFileSync(
    join(migrationsDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

async function runDrizzleGeneration({ command }: { command: string[] }): Promise<number> {
  const child = Bun.spawn(command, {
    cwd: resolve(__dirname, '..'),
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return child.exited;
}

export async function executeCheckedMigrationGeneration({
  args,
  migrationsDir = resolve(__dirname, '../migrations'),
  loadCurrentManifest = readManifest,
  run = runDrizzleGeneration,
  createCandidateManifest = createManifestFromDirectory,
  writeManifest = writeManifestFile,
  log = console.log,
}: ExecuteCheckedMigrationGenerationOptions): Promise<void> {
  const forbiddenArguments = ['--out', '--config', '--schema', '--dialect'];
  for (const argument of args) {
    const forbidden = forbiddenArguments.find(
      (candidate) => argument === candidate || argument.startsWith(`${candidate}=`),
    );
    if (forbidden) {
      throw new Error(`Checked migration generation does not allow ${forbidden}`);
    }
  }
  const previousManifest = loadCurrentManifest(migrationsDir);
  const exitCode = await run({
    command: ['bun', 'x', 'drizzle-kit', 'generate', ...args],
  });
  if (exitCode !== 0) {
    throw new Error(`Drizzle migration generation failed with exit code ${exitCode}`);
  }

  const candidateManifest = createCandidateManifest(migrationsDir);
  validateMigrationManifestImmutablePrefix(previousManifest, candidateManifest);
  const appendedCount = candidateManifest.entries.length - previousManifest.entries.length;
  if (appendedCount === 0) {
    log('No new checked migration artifacts were generated.');
    return;
  }
  writeManifest(migrationsDir, candidateManifest);
  log(`Sealed ${appendedCount} new checked migration artifact(s).`);
}

if (import.meta.main) {
  executeCheckedMigrationGeneration({ args: process.argv.slice(2) }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
