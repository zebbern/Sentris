import { describe, expect, it } from 'bun:test';

const { buildSmokeCommands, resolveSmokeEnvironment } =
  require('../production-compose-smoke.js') as {
    buildSmokeCommands: (
      waitTimeoutSeconds?: number,
      trustProfile?: 'trusted-local' | 'hardened',
    ) => { name: string; command: string; args: string[] }[];
    resolveSmokeEnvironment: (
      input: Record<string, string | undefined>,
    ) => Record<string, string | undefined>;
  };

describe('lifecycle durability release wiring', () => {
  it('creates, migrates, isolates, runs, and drops an instance-named lifecycle database before the API journey', () => {
    const commands = buildSmokeCommands(120, 'trusted-local');
    const names = commands.map((command) => command.name);
    const resetIndex = names.indexOf('lifecycle-db-reset');
    const migrateIndex = names.indexOf('lifecycle-db-migrate');
    const quiescentIndex = names.indexOf('lifecycle-db-quiescent');
    const lifecycleIndex = commands.findIndex((command) => command.name === 'lifecycle-durability');
    const dropIndex = names.indexOf('lifecycle-db-drop');
    const journeyIndex = commands.findIndex((command) => command.name === 'critical-journey');

    expect([resetIndex, migrateIndex, quiescentIndex, lifecycleIndex, dropIndex]).toEqual(
      [...[resetIndex, migrateIndex, quiescentIndex, lifecycleIndex, dropIndex]].sort(
        (left, right) => left - right,
      ),
    );
    expect(resetIndex).toBeGreaterThan(0);
    expect(dropIndex).toBeLessThan(journeyIndex);
    expect(commands[lifecycleIndex]).toMatchObject({
      name: 'lifecycle-durability',
      command: 'docker',
      args: [
        'compose',
        '-f',
        'docker/docker-compose.full.yml',
        'exec',
        '-T',
        '-e',
        'CI',
        '-e',
        'SENTRIS_ALLOW_LIFECYCLE_DURABILITY_SMOKE',
        '-e',
        'SENTRIS_INSTANCE',
        '-e',
        'LIFECYCLE_DURABILITY_SMOKE_DATABASE_URL',
        'backend',
        'sh',
        '-ec',
        'exec timeout --signal=TERM --kill-after=15 570 bun run smoke:lifecycle-durability',
      ],
      timeoutMs: 600_000,
    });

    const rendered = commands.map(({ command, args }) => `${command} ${args.join(' ')}`);
    expect(rendered[resetIndex]).toContain('sentris_lifecycle_smoke_i${SENTRIS_INSTANCE}');
    expect(rendered[resetIndex]).toContain(
      'Lifecycle database reset target: $LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME',
    );
    expect(rendered[resetIndex]).toContain('timeout -s TERM -k 5');
    expect(rendered[resetIndex]).toContain('dropdb --if-exists --force');
    expect(rendered[resetIndex]).toContain('createdb');
    expect(rendered[migrateIndex]).toContain(
      '-e DRIZZLE_DATABASE_URL -e LIFECYCLE_DURABILITY_SMOKE_PGOPTIONS backend sh -ec',
    );
    expect(rendered[migrateIndex]).toContain(
      'exec timeout --signal=TERM --kill-after=15 210 bun run migration:run',
    );
    expect(rendered[quiescentIndex]).toContain('pg_stat_activity');
    expect(rendered[quiescentIndex]).toContain('timeout -s TERM -k 5');
    expect(rendered[dropIndex]).toContain(
      'Lifecycle database drop target: $LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME',
    );
    expect(rendered[dropIndex]).toContain('timeout -s TERM -k 5');
    expect(rendered[dropIndex]).toContain('dropdb --if-exists --force');
  });

  it('checks quiescence for the exact owned database through psql stdin variable binding', () => {
    const command = buildSmokeCommands(120, 'trusted-local').find(
      ({ name }) => name === 'lifecycle-db-quiescent',
    );
    const shellScript = command?.args.at(-1);

    expect(command?.args).toEqual(
      expect.arrayContaining([
        '-e',
        'SENTRIS_INSTANCE',
        '-e',
        'LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME',
      ]),
    );
    expect(shellScript).toContain('expected="sentris_lifecycle_smoke_i${SENTRIS_INSTANCE}"');
    expect(shellScript).toContain('test "$LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME" = "$expected"');
    expect(shellScript).toContain('--set=smoke_db="$LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME"');
    expect(shellScript).toContain("--file=- <<'SQL'");
    expect(shellScript).toContain("WHERE datname = :'smoke_db'");
    expect(shellScript).not.toContain('--command');
  });

  it('passes the internal PostgreSQL target and nested destructive approval to the harness', () => {
    const environment = resolveSmokeEnvironment({
      CI: 'true',
      SENTRIS_INSTANCE: '6',
    });

    expect(environment.SENTRIS_ALLOW_LIFECYCLE_DURABILITY_SMOKE).toBe('true');
    expect(environment.LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME).toBe('sentris_lifecycle_smoke_i6');
    expect(environment.LIFECYCLE_DURABILITY_SMOKE_DATABASE_URL).toBe(
      'postgresql://sentris:sentris@postgres:5432/sentris_lifecycle_smoke_i6',
    );
    expect(environment.DRIZZLE_DATABASE_URL).toBe(
      'postgresql://sentris:sentris@postgres:5432/sentris_lifecycle_smoke_i6',
    );
    expect(environment.LIFECYCLE_DURABILITY_SMOKE_PGOPTIONS).toBe(
      '-c statement_timeout=120000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=30000',
    );
  });

  it('rejects a caller override that could move destructive retention outside the owned database', () => {
    expect(() =>
      resolveSmokeEnvironment({
        CI: 'true',
        SENTRIS_INSTANCE: '6',
        LIFECYCLE_DURABILITY_SMOKE_DATABASE_URL:
          'postgresql://sentris:sentris@postgres:5432/sentris',
      }),
    ).toThrow('production Compose smoke owns lifecycle database');
  });
});
