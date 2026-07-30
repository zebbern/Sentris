import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'bun:test';
import {
  loadRepositoryPolicyFiles,
  validateAuthoritativeMigrationReferences,
} from '../../check-migrations';

describe('authoritative migration repository policy', () => {
  it('rejects config and runtime scripts that point at the legacy directory', () => {
    expect(
      validateAuthoritativeMigrationReferences(
        new Map([
          ['backend/drizzle.config.ts', "export default { out: './drizzle' };"],
          ['backend/scripts/migration-smoke.ts', "resolve(__dirname, '../drizzle');"],
        ]),
      ),
    ).toEqual([
      'backend/drizzle.config.ts points at legacy backend/drizzle',
      'backend/drizzle.config.ts must set Drizzle output to ./migrations',
      'backend/scripts/migration-smoke.ts points at legacy backend/drizzle',
    ]);
  });

  it('does not exempt a direct schema push based on a developer-only script name', () => {
    expect(
      validateAuthoritativeMigrationReferences(
        new Map([
          [
            'backend/package.json',
            JSON.stringify({
              scripts: {
                dev: 'bun run migration:push && bun src/main.ts',
                'migration:push:dev-only': 'bun x drizzle-kit push',
              },
            }),
          ],
          ['Dockerfile', 'CMD ["sh", "-c", "bun x drizzle-kit push"]'],
        ]),
      ),
    ).toEqual([
      'backend/package.json script "dev" invokes schema push',
      'backend/package.json script "migration:push:dev-only" invokes schema push',
      'backend/package.json migration:generate must use the checked generation wrapper',
      'backend/package.json migration:push:dev-only must use the disposable-development guard',
      'Dockerfile invokes schema push',
    ]);
  });

  it('rejects array-form push bypasses and requires the disposable wrapper guard contract', () => {
    expect(
      validateAuthoritativeMigrationReferences(
        new Map([
          [
            'backend/scripts/bypass.ts',
            "Bun.spawn(['bun', 'x', 'drizzle-kit', 'push', '--force'])",
          ],
          ['backend/scripts/push-schema-dev.ts', "Bun.spawn(['bun', 'x', 'drizzle-kit', 'push'])"],
        ]),
      ),
    ).toEqual([
      'backend/scripts/bypass.ts invokes schema push',
      'backend/scripts/push-schema-dev.ts invokes schema push without the required disposable-development guards',
    ]);
  });

  it('rejects bypassing the checked generation wrapper', () => {
    expect(
      validateAuthoritativeMigrationReferences(
        new Map([
          [
            'backend/package.json',
            JSON.stringify({
              scripts: {
                'migration:generate': 'bun x drizzle-kit generate',
                'migration:push:dev-only': 'bun scripts/push-schema-dev.ts',
              },
            }),
          ],
        ]),
      ),
    ).toEqual(['backend/package.json migration:generate must use the checked generation wrapper']);
  });

  it('passes against all authoritative files in this repository', () => {
    const repoRoot = resolve(__dirname, '../../../..');
    const files = loadRepositoryPolicyFiles(repoRoot);

    expect(validateAuthoritativeMigrationReferences(files)).toEqual([]);
    expect(files.has('backend/scripts/run-migrations.ts')).toBe(true);
    expect(files.has('scripts/db-reset-instance.sh')).toBe(true);
    expect(readFileSync(resolve(repoRoot, 'backend/drizzle/README.md'), 'utf8')).toContain(
      'non-authoritative',
    );
    expect(existsSync(resolve(repoRoot, 'backend/migrations/manifest.json'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'backend/migrations/meta/manifest.json'))).toBe(false);
  });
});
