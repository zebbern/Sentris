/* eslint-disable no-console -- This repository check is a command-line program. */
import { readFileSync, readdirSync } from 'fs';
import { relative, resolve } from 'path';
import { loadMigrationPlan } from '../src/database/migrations/checked-migrations';

const FIXED_POLICY_PATHS = [
  'backend/drizzle.config.ts',
  'backend/package.json',
  'backend/src/database/migration.guard.ts',
  'package.json',
  'Dockerfile',
  'justfile',
  'pm2.config.cjs',
] as const;
const SCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.ps1', '.sh', '.ts', '.yaml', '.yml']);
const POLICY_SCAN_DIRECTORIES = ['backend/scripts', 'scripts', 'docker'] as const;
const GUARDED_PUSH_WRAPPER_PATH = 'backend/scripts/push-schema-dev.ts';

const LEGACY_DIRECTORY_REFERENCE = /(?:\.{1,2}[\\/]|backend[\\/])drizzle(?:[\\/]|['"`])/i;
const SCHEMA_PUSH_COMMAND = /(?:migration:push|drizzle-kit[^A-Za-z0-9]{1,80}push)/i;

function hasRequiredDisposablePushGuards(content: string): boolean {
  return [
    'assertDisposableDevSchemaPushAllowed',
    'assertNoSchemaPushTargetOverrides',
    'SENTRIS_ALLOW_DISPOSABLE_SCHEMA_PUSH',
    'getScriptDatabaseTarget',
    'formatDatabaseTarget',
    'redactedConnectionString',
    'DRIZZLE_DATABASE_URL: target.connectionString',
  ].every((requiredMarker) => content.includes(requiredMarker));
}

export function loadRepositoryPolicyFiles(repoRoot: string): ReadonlyMap<string, string> {
  const paths = new Set<string>(FIXED_POLICY_PATHS);

  for (const relativeDirectory of POLICY_SCAN_DIRECTORIES) {
    const absoluteDirectory = resolve(repoRoot, relativeDirectory);
    for (const entry of readdirSync(absoluteDirectory, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || entry.parentPath.includes('__tests__')) {
        continue;
      }
      const extension = entry.name.slice(entry.name.lastIndexOf('.'));
      if (!SCRIPT_EXTENSIONS.has(extension)) {
        continue;
      }

      const absolutePath = resolve(entry.parentPath, entry.name);
      const path = relative(repoRoot, absolutePath).replaceAll('\\', '/');
      if (path !== 'backend/scripts/check-migrations.ts') {
        paths.add(path);
      }
    }
  }

  return new Map(
    [...paths].sort().map((path) => [path, readFileSync(resolve(repoRoot, path), 'utf8')]),
  );
}

export function validateAuthoritativeMigrationReferences(
  files: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];

  for (const [path, content] of files) {
    if (LEGACY_DIRECTORY_REFERENCE.test(content)) {
      errors.push(`${path} points at legacy backend/drizzle`);
    }

    if (path === 'backend/drizzle.config.ts') {
      if (!/out:\s*['"]\.\/migrations['"]/.test(content)) {
        errors.push('backend/drizzle.config.ts must set Drizzle output to ./migrations');
      }
      continue;
    }

    if (path === 'backend/package.json') {
      const parsed = JSON.parse(content) as { scripts?: Record<string, unknown> };
      const scripts = parsed.scripts ?? {};
      for (const [scriptName, command] of Object.entries(scripts)) {
        if (typeof command === 'string' && SCHEMA_PUSH_COMMAND.test(command)) {
          errors.push(`backend/package.json script "${scriptName}" invokes schema push`);
        }
      }
      if (scripts['migration:generate'] !== 'bun scripts/generate-migration.ts') {
        errors.push(
          'backend/package.json migration:generate must use the checked generation wrapper',
        );
      }
      if (scripts['migration:push:dev-only'] !== 'bun scripts/push-schema-dev.ts') {
        errors.push(
          'backend/package.json migration:push:dev-only must use the disposable-development guard',
        );
      }
      continue;
    }

    if (SCHEMA_PUSH_COMMAND.test(content)) {
      if (path === GUARDED_PUSH_WRAPPER_PATH) {
        if (!hasRequiredDisposablePushGuards(content)) {
          errors.push(
            `${path} invokes schema push without the required disposable-development guards`,
          );
        }
      } else {
        errors.push(`${path} invokes schema push`);
      }
    }
  }

  return errors;
}

export function checkMigrationRepository(repoRoot: string): void {
  const migrationsDir = resolve(repoRoot, 'backend/migrations');
  const plan = loadMigrationPlan(migrationsDir);
  const policyErrors = validateAuthoritativeMigrationReferences(
    loadRepositoryPolicyFiles(repoRoot),
  );
  if (policyErrors.length > 0) {
    throw new Error(`Migration repository policy failed:\n- ${policyErrors.join('\n- ')}`);
  }

  console.log(`Validated ${plan.migrations.length} authoritative migration(s):`);
  for (const migration of plan.migrations) {
    console.log(
      `- ${migration.tag} sql:${migration.checksum} snapshot:${migration.snapshotChecksum} contract:${migration.contractChecksum}`,
    );
  }
}

if (import.meta.main) {
  try {
    checkMigrationRepository(resolve(__dirname, '../..'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
