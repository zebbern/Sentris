import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  getScriptDatabaseTarget,
  readActiveInstance,
  redactConnectionString,
} from '../lib/script-database-target';

let cleanupDirs: string[] = [];
const scriptsDir = dirname(dirname(fileURLToPath(import.meta.url)));

function createRootWithInstance(instance: string): string {
  const root = mkdtempSync(join(tmpdir(), 'sentris-script-db-target-'));
  writeFileSync(join(root, '.sentris-instance'), `${instance}\n`);
  cleanupDirs.push(root);
  return root;
}

describe('script database target resolver', () => {
  afterEach(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    cleanupDirs = [];
  });

  it('uses SENTRIS_INSTANCE instead of a stale DATABASE_URL for local scripts', () => {
    const target = getScriptDatabaseTarget({
      env: {
        SENTRIS_INSTANCE: '5',
        DATABASE_URL: 'postgresql://sentris:sentris@localhost:5433/sentris',
      },
      repoRoot: createRootWithInstance('2'),
    });

    expect(target.connectionString).toBe(
      'postgresql://sentris:sentris@localhost:5433/sentris_instance_5',
    );
    expect(target.databaseName).toBe('sentris_instance_5');
    expect(target.source).toBe('env:SENTRIS_INSTANCE');
    expect(target.ignoredDatabaseUrl).toBe(true);
  });

  it('uses the active instance marker when SENTRIS_INSTANCE is absent', () => {
    const target = getScriptDatabaseTarget({
      env: {},
      repoRoot: createRootWithInstance('3'),
    });

    expect(target.connectionString).toBe(
      'postgresql://sentris:sentris@localhost:5433/sentris_instance_3',
    );
    expect(target.databaseName).toBe('sentris_instance_3');
    expect(target.source).toBe('file:.sentris-instance');
  });

  it('prefers a script-specific database override over the generic script override', () => {
    const target = getScriptDatabaseTarget({
      overrideEnvVar: 'TEMPLATE_SEED_DATABASE_URL',
      env: {
        SENTRIS_INSTANCE: '1',
        SENTRIS_SCRIPT_DATABASE_URL: 'postgresql://sentris:sentris@localhost:5433/shared_override',
        TEMPLATE_SEED_DATABASE_URL: 'postgresql://sentris:sentris@localhost:5433/template_override',
      },
      repoRoot: createRootWithInstance('2'),
    });

    expect(target.connectionString).toBe(
      'postgresql://sentris:sentris@localhost:5433/template_override',
    );
    expect(target.databaseName).toBe('template_override');
    expect(target.source).toBe('env:TEMPLATE_SEED_DATABASE_URL');
  });

  it('falls back to instance 0 when no instance is configured', () => {
    const target = getScriptDatabaseTarget({ env: {}, repoRoot: createRootWithInstance('') });

    expect(target.connectionString).toBe(
      'postgresql://sentris:sentris@localhost:5433/sentris_instance_0',
    );
    expect(target.databaseName).toBe('sentris_instance_0');
    expect(target.source).toBe('default:instance-0');
  });

  it('rejects invalid instance values before building a database URL', () => {
    expect(() => readActiveInstance({ env: { SENTRIS_INSTANCE: 'dev' } })).toThrow(
      'SENTRIS_INSTANCE must be an integer from 0 to 9',
    );
  });

  it('redacts credentials before printing database targets', () => {
    expect(
      redactConnectionString('postgresql://sentris:secret@localhost:5433/sentris_instance_0'),
    ).toBe('postgresql://sentris:***@localhost:5433/sentris_instance_0');
  });

  it('prevents backend maintenance scripts from reading DATABASE_URL directly', () => {
    const scriptFiles = readdirSync(scriptsDir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => file !== 'generate-openapi.ts' && file !== 'version-check-summary.ts');

    for (const file of scriptFiles) {
      const source = readFileSync(join(scriptsDir, file), 'utf-8');
      expect(source, `${file} should use script-database-target.ts`).not.toContain(
        'process.env.DATABASE_URL',
      );
      expect(source, `${file} should not fall back to the legacy sentris database`).not.toContain(
        'postgresql://sentris:sentris@localhost:5433/sentris',
      );
    }
  });
});
