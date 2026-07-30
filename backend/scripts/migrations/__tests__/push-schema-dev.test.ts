import { describe, expect, it } from 'bun:test';
import {
  assertDisposableDevSchemaPushAllowed,
  executeDisposableDevSchemaPush,
} from '../../push-schema-dev';

describe('disposable development schema push guard', () => {
  it('requires an explicit disposable-database opt-in', () => {
    expect(() => assertDisposableDevSchemaPushAllowed({})).toThrow(
      'Set SENTRIS_ALLOW_DISPOSABLE_SCHEMA_PUSH=true',
    );
    expect(() =>
      assertDisposableDevSchemaPushAllowed({
        SENTRIS_ALLOW_DISPOSABLE_SCHEMA_PUSH: 'true',
      }),
    ).not.toThrow();
  });

  it.each([
    { NODE_ENV: 'production' },
    { NODE_ENV: 'prod' },
    { NODE_ENV: 'staging' },
    { SENTRIS_ENV: 'production' },
    { SENTRIS_ENV: 'staging' },
  ])('rejects production-like environments even with opt-in: %p', (productionEnv) => {
    expect(() =>
      assertDisposableDevSchemaPushAllowed({
        SENTRIS_ALLOW_DISPOSABLE_SCHEMA_PUSH: 'true',
        ...productionEnv,
      }),
    ).toThrow('Schema push is disabled in production-like environments');
  });
});

describe('disposable development schema push command', () => {
  it.each([
    '--config=other.config.ts',
    '--url=postgresql://operator:secret@prod.example/sentris',
    '--host=prod.example',
    '--port=5432',
    '--user=operator',
    '--password=secret',
    '--database=sentris',
    '--ssl=require',
    '--auth-token=secret',
    '--tlsSecurity=strict',
    '--driver=aws-data-api',
  ])('rejects %s so CLI arguments cannot bypass the shared resolved target', async (argument) => {
    await expect(
      executeDisposableDevSchemaPush({
        args: [argument],
        env: { SENTRIS_ALLOW_DISPOSABLE_SCHEMA_PUSH: 'true' },
        resolveTarget() {
          throw new Error('must reject before resolving a target');
        },
      }),
    ).rejects.toThrow('Schema push target overrides are not allowed');
  });

  it('prints a redacted shared-runtime target before invoking Drizzle against that exact target', async () => {
    const events: string[] = [];

    await executeDisposableDevSchemaPush({
      args: ['--strict'],
      env: {
        SENTRIS_ALLOW_DISPOSABLE_SCHEMA_PUSH: 'true',
        DATABASE_URL: 'postgresql://ignored:ignored@example.invalid/production',
      },
      resolveTarget: () => ({
        connectionString: 'postgresql://sentris:secret@localhost:5433/sentris_instance_4',
        redactedConnectionString: 'postgresql://sentris:***@localhost:5433/sentris_instance_4',
        databaseName: 'sentris_instance_4',
        source: 'env:SENTRIS_INSTANCE',
        ignoredDatabaseUrl: true,
      }),
      log(message) {
        events.push(`log:${message}`);
      },
      async run({ command, env }) {
        events.push(`run:${command.join(' ')}`);
        events.push(`target:${env.DRIZZLE_DATABASE_URL}`);
        return 0;
      },
    });

    expect(events).toEqual([
      'log:Target database: sentris_instance_4 via env:SENTRIS_INSTANCE (DATABASE_URL ignored; use a script-specific override to target another DB)',
      'log:Connection: postgresql://sentris:***@localhost:5433/sentris_instance_4',
      'log:Running irreversible schema push only against the opted-in disposable development database.',
      'run:bun x drizzle-kit push --strict',
      'target:postgresql://sentris:secret@localhost:5433/sentris_instance_4',
    ]);
    expect(events.filter((event) => event.startsWith('log:')).join('\n')).not.toContain(
      'sentris:secret@',
    );
  });

  it('surfaces a non-zero Drizzle exit without claiming success', async () => {
    await expect(
      executeDisposableDevSchemaPush({
        args: [],
        env: { SENTRIS_ALLOW_DISPOSABLE_SCHEMA_PUSH: 'true' },
        resolveTarget: () => ({
          connectionString: 'postgresql://sentris:secret@localhost:5433/disposable',
          redactedConnectionString: 'postgresql://sentris:***@localhost:5433/disposable',
          databaseName: 'disposable',
          source: 'test',
          ignoredDatabaseUrl: false,
        }),
        log() {},
        async run() {
          return 7;
        },
      }),
    ).rejects.toThrow('Drizzle schema push failed with exit code 7');
  });
});
