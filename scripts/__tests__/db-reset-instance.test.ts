import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  executeDbResetCommand,
  NativeCommandError,
  parseDbResetArgs,
  resolveDbResetTarget,
  type ProcessInvocation,
  runNativeProcess,
  validateDbResetTarget,
} from '../db-reset-instance';

describe('database reset arguments', () => {
  it('accepts an explicit one-off instance', () => {
    expect(parseDbResetArgs(['--instance', '4'])).toEqual({ instance: '4' });
  });

  it.each([['--instance'], ['--instance', '10'], ['4'], ['--force']])(
    'rejects an unsupported or ambiguous argument list: %p',
    (...args) => {
      expect(() => parseDbResetArgs(args)).toThrow(
        'Usage: bun run db:reset [-- --instance <0-9>]',
      );
    },
  );
});

describe('database reset target', () => {
  it('uses the active instance marker when no one-off instance is supplied', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'sentris-db-reset-'));
    try {
      writeFileSync(join(repoRoot, '.sentris-instance'), '3\n');

      const resolved = resolveDbResetTarget({ args: [], env: {}, repoRoot });

      expect(resolved).toEqual({
        instance: '3',
        target: {
          connectionString:
            'postgresql://sentris:sentris@localhost:5433/sentris_instance_3',
          redactedConnectionString:
            'postgresql://sentris:***@localhost:5433/sentris_instance_3',
          databaseName: 'sentris_instance_3',
          source: 'file:.sentris-instance',
          ignoredDatabaseUrl: false,
        },
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('lets an explicit one-off instance take precedence over the active environment', () => {
    const resolved = resolveDbResetTarget({
      args: ['--instance', '4'],
      env: {
        SENTRIS_INSTANCE: '2',
        DATABASE_URL: 'postgresql://ignored:secret@remote.invalid/legacy',
      },
    });

    expect(resolved.instance).toBe('4');
    expect(resolved.target.databaseName).toBe('sentris_instance_4');
    expect(resolved.target.source).toBe('env:SENTRIS_INSTANCE');
    expect(resolved.target.ignoredDatabaseUrl).toBe(true);
  });

  it.each(['SENTRIS_SCRIPT_DATABASE_URL', 'DRIZZLE_DATABASE_URL'])(
    'rejects %s because a destructive reset only supports an exact instance target',
    (variable) => {
      expect(() =>
        resolveDbResetTarget({
          args: ['--instance', '4'],
          env: {
            [variable]: 'postgresql://sentris:secret@remote.invalid:5432/sentris_instance_4',
          },
        }),
      ).toThrow('Database URL overrides are not supported by db:reset');
    },
  );

  it('rejects a resolved target unless its local endpoint and database exactly match the instance', () => {
    expect(() =>
      validateDbResetTarget({
        instance: '4',
        target: {
          connectionString:
            'postgresql://sentris:secret@remote.invalid:5432/sentris_instance_4',
          redactedConnectionString:
            'postgresql://sentris:***@remote.invalid:5432/sentris_instance_4',
          databaseName: 'sentris_instance_4',
          source: 'env:SENTRIS_INSTANCE',
          ignoredDatabaseUrl: false,
        },
      }),
    ).toThrow(
      'Refusing database reset: expected postgresql://sentris@localhost:5433/sentris_instance_4',
    );
  });
});

describe('database reset execution', () => {
  it('terminates only the selected database, recreates it, and runs checked migrations', async () => {
    const invocations: ProcessInvocation[] = [];
    const logs: string[] = [];

    const result = await executeDbResetCommand({
      args: ['--instance', '4'],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        DATABASE_URL: 'postgresql://ignored:secret@remote.invalid/legacy',
        NODE_ENV: 'production',
      },
      async runProcess(invocation) {
        invocations.push(invocation);
        return {
          stdout:
            invocation.command === 'docker' && invocation.args[0] === 'ps'
              ? 'sentris-postgres\r\n'
              : '',
          stderr: '',
        };
      },
      log(message) {
        logs.push(message);
      },
    });

    expect(result).toEqual({
      databaseName: 'sentris_instance_4',
      instance: '4',
    });
    expect(invocations).toHaveLength(3);
    expect(invocations[0]).toMatchObject({
      command: 'docker',
      args: [
        'ps',
        '--filter',
        'name=^/sentris-postgres$',
        '--filter',
        'status=running',
        '--format',
        '{{.Names}}',
      ],
      captureOutput: true,
    });
    expect(invocations[1]).toMatchObject({
      command: 'docker',
      args: [
        'exec',
        'sentris-postgres',
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'sentris',
        '-d',
        'postgres',
        '-c',
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'sentris_instance_4' AND pid <> pg_backend_pid();",
        '-c',
        'DROP DATABASE IF EXISTS "sentris_instance_4";',
        '-c',
        'CREATE DATABASE "sentris_instance_4" OWNER sentris;',
        '-c',
        'GRANT ALL PRIVILEGES ON DATABASE "sentris_instance_4" TO sentris;',
      ],
      captureOutput: false,
    });
    expect(invocations[2]?.command).toBe(process.execPath);
    expect(invocations[2]?.args).toEqual(['--cwd=backend', 'run', 'migration:run']);
    expect(invocations[2]?.env).toMatchObject({
      DRIZZLE_DATABASE_URL:
        'postgresql://sentris:sentris@localhost:5433/sentris_instance_4',
      NODE_ENV: 'development',
      SENTRIS_ENV: 'development',
      SENTRIS_INSTANCE: '4',
    });
    expect(invocations[2]?.env).not.toHaveProperty('DATABASE_URL');
    expect(logs.join('\n')).toContain(
      'Target database: sentris_instance_4 via env:SENTRIS_INSTANCE',
    );
    expect(logs.join('\n')).toContain(
      'Connection: postgresql://sentris:***@localhost:5433/sentris_instance_4',
    );
    expect(logs.join('\n')).not.toContain('ignored:secret');
    expect(logs.at(-1)).toBe('Database reset complete for instance 4.');
  });

  it('refuses a partial or similarly named PostgreSQL container match before mutation', async () => {
    const invocations: ProcessInvocation[] = [];

    await expect(
      executeDbResetCommand({
        args: ['--instance', '4'],
        env: {},
        async runProcess(invocation) {
          invocations.push(invocation);
          return { stdout: 'sentris-postgres-shadow\n', stderr: '' };
        },
        log() {},
      }),
    ).rejects.toThrow('PostgreSQL container sentris-postgres is not running');

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.args[0]).toBe('ps');
  });

  it('preserves a native child exit code so Windows command failures cannot look successful', async () => {
    try {
      await runNativeProcess({
        command: process.execPath,
        args: ['-e', 'process.exit(7)'],
        cwd: process.cwd(),
        captureOutput: true,
      });
      throw new Error('Expected the native child to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(NativeCommandError);
      expect((error as NativeCommandError).exitCode).toBe(7);
    }
  });

  it('returns a nonzero CLI status before any mutation when arguments are invalid', () => {
    const result = Bun.spawnSync(
      [process.execPath, 'scripts/db-reset-instance.ts', '--instance', '10'],
      {
        cwd: process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      'Usage: bun run db:reset [-- --instance <0-9>]',
    );
  });

  it('exposes the same cross-platform command through the root package script', () => {
    const result = Bun.spawnSync(
      [process.execPath, 'run', 'db:reset', '--', '--instance', '10'],
      {
        cwd: process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      'Usage: bun run db:reset [-- --instance <0-9>]',
    );
  });
});
