import { describe, expect, it } from 'bun:test';

const smoke = await import('../telemetry-durability-smoke').catch(() => undefined);
const DATABASE_URL =
  'postgresql://telemetry-user:database-secret@postgres.internal:5432/sentris_telemetry_durability_smoke_i4';
const SUITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STARTED_AT = new Date().toISOString();

function allowedEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    CI: 'true',
    SENTRIS_INSTANCE: '4',
    COMPOSE_PROJECT_NAME: 'sentris-telemetry-durability-smoke-i4',
    SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: 'true',
    TELEMETRY_DURABILITY_SMOKE_DATABASE_URL: DATABASE_URL,
    TELEMETRY_DURABILITY_SMOKE_BACKEND_URL: 'http://backend.internal:3211',
    TELEMETRY_DURABILITY_SMOKE_INTERNAL_TOKEN: 'internal-token-secret',
    TELEMETRY_DURABILITY_SMOKE_KAFKA_BROKERS: 'redpanda.internal:9092',
    TELEMETRY_DURABILITY_SMOKE_EVENT_TOPIC_BASE: 'telemetry.events',
    TELEMETRY_DURABILITY_SMOKE_LOG_TOPIC_BASE: 'telemetry.logs',
    TELEMETRY_DURABILITY_SMOKE_LOKI_URL: 'https://loki-user:loki-secret@loki.internal:3100',
    TELEMETRY_DURABILITY_SMOKE_SUITE_ID: SUITE_ID,
    TELEMETRY_DURABILITY_SMOKE_STARTED_AT: STARTED_AT,
    TELEMETRY_DURABILITY_SMOKE_PHASE: 'direct',
    ...overrides,
  };
}

describe('telemetry durability smoke module', () => {
  it('provides the guarded phased release harness', () => {
    expect(smoke).toBeDefined();
    expect(Object.keys(smoke ?? {})).toEqual(
      expect.arrayContaining([
        'resolveTelemetryDurabilityConfig',
        'buildTelemetryDurabilityFixtures',
        'buildTelemetryCleanupStatements',
        'buildTelemetryResidualCountStatements',
        'executeTelemetryDurabilityReleasePlan',
        'executeCooperativeDeadline',
        'runTelemetryDurabilitySmoke',
      ]),
    );
  });
});

describe('telemetry durability smoke guard', () => {
  it('requires an explicit instance and rejects unsupported instance values', () => {
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(allowedEnvironment({ SENTRIS_INSTANCE: undefined })),
    ).toThrow('SENTRIS_INSTANCE must be set explicitly');
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(allowedEnvironment({ SENTRIS_INSTANCE: '10' })),
    ).toThrow('SENTRIS_INSTANCE must be an integer from 0 to 9');
  });

  it('requires CI or its dedicated operator opt-in', () => {
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({
          CI: undefined,
          SENTRIS_ALLOW_TELEMETRY_DURABILITY_SMOKE: undefined,
        }),
      ),
    ).toThrow('Telemetry durability smoke is destructive');

    expect(
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({
          CI: undefined,
          SENTRIS_ALLOW_TELEMETRY_DURABILITY_SMOKE: 'true',
        }),
      ).instance,
    ).toBe('4');
  });

  it('fails closed unless the Compose project and database are the exact disposable targets', () => {
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({ SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: undefined }),
      ),
    ).toThrow('requires SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT=true');
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({ COMPOSE_PROJECT_NAME: 'sentris' }),
      ),
    ).toThrow('must use disposable Compose project sentris-telemetry-durability-smoke-i4');
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({
          TELEMETRY_DURABILITY_SMOKE_DATABASE_URL:
            'postgresql://sentris:sentris@postgres:5432/sentris_instance_4',
        }),
      ),
    ).toThrow('must target dedicated database sentris_telemetry_durability_smoke_i4');
  });

  it('also accepts only the existing disposable production-Compose project/database tuple', () => {
    const config = smoke!.resolveTelemetryDurabilityConfig(
      allowedEnvironment({
        COMPOSE_PROJECT_NAME: 'sentris-production-smoke-4',
        TELEMETRY_DURABILITY_SMOKE_DATABASE_URL:
          'postgresql://sentris:sentris@postgres:5432/sentris',
      }),
    );
    expect(config.targetProfile).toBe('production-compose');
    expect(config.databaseTarget.databaseName).toBe('sentris');
    expect(config.eventGroupId).toBe('sentris-event-ingestor-4');
    expect(config.logGroupId).toBe('sentris-backend-log-consumer-4');

    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({
          COMPOSE_PROJECT_NAME: 'sentris-production-smoke-4',
          TELEMETRY_DURABILITY_SMOKE_DATABASE_URL: DATABASE_URL,
        }),
      ),
    ).toThrow('project/database tuple');
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({
          COMPOSE_PROJECT_NAME: 'sentris-production-smoke-custom',
          TELEMETRY_DURABILITY_SMOKE_DATABASE_URL:
            'postgresql://sentris:sentris@postgres:5432/sentris',
        }),
      ),
    ).toThrow('project/database tuple');
  });

  it('requires only the script-specific database override', () => {
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({
          TELEMETRY_DURABILITY_SMOKE_DATABASE_URL: undefined,
          SENTRIS_SCRIPT_DATABASE_URL: DATABASE_URL,
        }),
      ),
    ).toThrow('requires TELEMETRY_DURABILITY_SMOKE_DATABASE_URL');
  });

  it('requires explicit backend, Kafka, topic, Loki, token, suite, and supported phase targets', () => {
    const required = [
      'TELEMETRY_DURABILITY_SMOKE_BACKEND_URL',
      'TELEMETRY_DURABILITY_SMOKE_INTERNAL_TOKEN',
      'TELEMETRY_DURABILITY_SMOKE_KAFKA_BROKERS',
      'TELEMETRY_DURABILITY_SMOKE_EVENT_TOPIC_BASE',
      'TELEMETRY_DURABILITY_SMOKE_LOG_TOPIC_BASE',
      'TELEMETRY_DURABILITY_SMOKE_LOKI_URL',
      'TELEMETRY_DURABILITY_SMOKE_SUITE_ID',
      'TELEMETRY_DURABILITY_SMOKE_STARTED_AT',
      'TELEMETRY_DURABILITY_SMOKE_PHASE',
    ];
    for (const key of required) {
      expect(() =>
        smoke!.resolveTelemetryDurabilityConfig(allowedEnvironment({ [key]: undefined })),
      ).toThrow(key);
    }
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({ TELEMETRY_DURABILITY_SMOKE_PHASE: 'all-at-once' }),
      ),
    ).toThrow('Unsupported telemetry durability phase');
  });

  it('requires one canonical recent timestamp anchor that can remain unchanged across phases', () => {
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({ TELEMETRY_DURABILITY_SMOKE_STARTED_AT: 'not-a-date' }),
      ),
    ).toThrow('TELEMETRY_DURABILITY_SMOKE_STARTED_AT');
    expect(() =>
      smoke!.resolveTelemetryDurabilityConfig(
        allowedEnvironment({
          TELEMETRY_DURABILITY_SMOKE_STARTED_AT: '2000-01-01T00:00:00.000Z',
        }),
      ),
    ).toThrow('must be recent');
    expect(
      smoke!.resolveTelemetryDurabilityConfig(allowedEnvironment()).startedAt.toISOString(),
    ).toBe(STARTED_AT);
  });

  it('resolves instance-scoped topics and prints only redacted targets', () => {
    const config = smoke!.resolveTelemetryDurabilityConfig(
      allowedEnvironment({
        DATABASE_URL: 'postgresql://wrong:wrong@wrong.invalid:5432/wrong',
      }),
    );
    expect(config.eventTopic).toBe('telemetry.events.instance-4');
    expect(config.logTopic).toBe('telemetry.logs.instance-4');
    expect(config.databaseTarget.source).toBe('env:TELEMETRY_DURABILITY_SMOKE_DATABASE_URL');
    expect(config.databaseTarget.ignoredDatabaseUrl).toBe(true);

    const summary = smoke!.formatTelemetryDurabilityTargets(config);
    expect(summary.join('\n')).not.toContain('database-secret');
    expect(summary.join('\n')).not.toContain('loki-secret');
    expect(summary.join('\n')).not.toContain('internal-token-secret');
    expect(summary.join('\n')).toContain('***');
    expect(summary.join('\n')).toContain('telemetry.events.instance-4');
  });

  it('bounds all database waits and connection concurrency', () => {
    const poolConfig = smoke!.buildTelemetryPoolConfig(
      smoke!.resolveTelemetryDurabilityConfig(allowedEnvironment()),
    );
    expect(poolConfig).toMatchObject({
      connectionString: DATABASE_URL,
      application_name: 'sentris-telemetry-durability-smoke-i4',
      max: 2,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      query_timeout: 15_000,
      lock_timeout: 3_000,
      idle_in_transaction_session_timeout: 10_000,
    });
  });
});

describe('telemetry durability fixture identity and cleanup', () => {
  it('builds stable, distinct logical trace/log identities from the explicit suite ID', () => {
    const config = smoke!.resolveTelemetryDurabilityConfig(allowedEnvironment());
    const first = smoke!.buildTelemetryDurabilityFixtures(config);
    const replay = smoke!.buildTelemetryDurabilityFixtures(config);
    expect(replay).toEqual(first);
    expect(first.organizationId).toContain(SUITE_ID);
    expect(first.direct.trace.eventId).not.toBe(first.fallback.trace.eventId);
    expect(first.direct.log.eventId).not.toBe(first.fallback.log.eventId);
    expect(first.direct.runId).toMatch(/^sentris-run-[0-9a-f-]{36}$/);
    expect(new Set(first.runIds).size).toBe(first.runIds.length);
    const timestamps = [
      Date.parse(first.direct.trace.timestamp),
      Date.parse(first.fallback.trace.timestamp),
      Date.parse(first.dead.trace.timestamp),
    ];
    const anchor = Date.parse(STARTED_AT);
    expect(timestamps.every((timestamp) => timestamp >= anchor && timestamp < anchor + 1_000)).toBe(
      true,
    );
    expect(new Set(timestamps).size).toBe(timestamps.length);
  });

  it('matches the production fallback hash and dedupe-key contract', () => {
    const identity = smoke!.durablePublicationIdentity(
      'telemetry.events.instance-4',
      'sentris-run-1',
      '{"eventId":"trace:1"}',
    );
    expect(identity.aggregateId).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.dedupeKey).toBe(`telemetry.kafka.publish.v1:${identity.aggregateId}`);
    expect(
      smoke!.durablePublicationIdentity(
        'telemetry.events.instance-4',
        'sentris-run-1',
        '{"eventId":"trace:1"}',
      ),
    ).toEqual(identity);
  });

  it('uses only parameterized exact fixture identities for cleanup and residual proof', () => {
    const fixtures = smoke!.buildTelemetryDurabilityFixtures(
      smoke!.resolveTelemetryDurabilityConfig(allowedEnvironment()),
    );
    const cleanup = smoke!.buildTelemetryCleanupStatements(fixtures);
    const residual = smoke!.buildTelemetryResidualCountStatements(fixtures);
    expect(cleanup.map((entry: { name: string }) => entry.name)).toEqual([
      'workflow traces',
      'workflow log streams',
      'audit logs',
      'outbox events',
    ]);
    expect(residual.map((entry: { name: string }) => entry.name)).toEqual([
      'workflow traces',
      'workflow log streams',
      'audit logs',
      'outbox events',
    ]);
    for (const statement of [...cleanup, ...residual]) {
      expect(statement.sql).toMatch(/\bWHERE\b/i);
      expect(statement.sql).not.toMatch(/\b(?:DROP|TRUNCATE|LIKE)\b/i);
      expect(statement.params.length).toBeGreaterThan(0);
    }
    expect(cleanup[0].params[0]).toEqual(fixtures.runIds);
    expect(cleanup[2].params[0]).toBe(fixtures.organizationId);
    expect(cleanup[3].params[0]).toBe(fixtures.organizationId);
  });
});

describe('telemetry durability orchestration', () => {
  it('orders direct, outage fallback, dead-letter, restart recovery, poison, quiescence, cleanup', async () => {
    const operations: string[] = [];
    await smoke!.executeTelemetryDurabilityReleasePlan({
      direct: async () => operations.push('direct'),
      fallbackDuringKafkaOutage: async () => operations.push('fallback'),
      awaitDeadLetterWhileKafkaIsDown: async () => operations.push('dead'),
      recoverAfterBackendAndKafkaRestart: async () => operations.push('recover'),
      poisonEvidence: async () => operations.push('poison'),
      quiesce: async () => operations.push('quiesce'),
      cleanup: async () => operations.push('cleanup'),
    });
    expect(operations).toEqual([
      'direct',
      'fallback',
      'dead',
      'recover',
      'poison',
      'quiesce',
      'cleanup',
    ]);
  });

  it('always quiesces and cleans up after failure and preserves cleanup failures', async () => {
    const operations: string[] = [];
    let caught: unknown;
    try {
      await smoke!.executeTelemetryDurabilityReleasePlan({
        direct: async () => operations.push('direct'),
        fallbackDuringKafkaOutage: async () => {
          operations.push('fallback');
          throw new Error('fallback assertion failed');
        },
        awaitDeadLetterWhileKafkaIsDown: async () => operations.push('dead'),
        recoverAfterBackendAndKafkaRestart: async () => operations.push('recover'),
        poisonEvidence: async () => operations.push('poison'),
        quiesce: async () => {
          operations.push('quiesce');
          throw new Error('quiesce failed');
        },
        cleanup: async () => {
          operations.push('cleanup');
          throw new Error('cleanup failed');
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(operations).toEqual(['direct', 'fallback', 'quiesce', 'cleanup']);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors.map(String).join('\n')).toContain(
      'fallback assertion failed',
    );
    expect((caught as AggregateError).errors.map(String).join('\n')).toContain('cleanup failed');
  });

  it('requires a changed externally captured backend generation across restart recovery', () => {
    expect(() => smoke!.assertBackendGenerationChanged(undefined, 'after')).toThrow(
      'backend generation before restart',
    );
    expect(() => smoke!.assertBackendGenerationChanged('same', 'same')).toThrow('must differ');
    expect(() => smoke!.assertBackendGenerationChanged('before', 'after')).not.toThrow();
  });

  it('aborts work at its deadline, gives cooperative cleanup a separate bound, and fails closed', async () => {
    const operations: string[] = [];
    await expect(
      smoke!.executeCooperativeDeadline(
        'bounded test',
        10,
        100,
        async (signal: AbortSignal) =>
          new Promise<void>((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                operations.push('work aborted');
                resolve();
              },
              { once: true },
            );
          }),
        async () => {
          operations.push('cleanup');
        },
      ),
    ).rejects.toThrow('bounded test exceeded its 10ms deadline');
    expect(operations).toEqual(['work aborted', 'cleanup']);
  });
});

describe('telemetry durability cleanup boundary', () => {
  it('declares that Kafka and Loki exact cleanup requires disposable volume teardown', () => {
    expect(smoke!.TELEMETRY_DURABILITY_EXTERNAL_CLEANUP_REQUIREMENT).toMatchObject({
      kafka: 'disposable-volume-teardown',
      loki: 'disposable-volume-teardown',
      postgres: 'exact-fixture-delete',
    });
  });

  it('states the criterion-scoped two-stream live coverage without implying four-stream projection', () => {
    expect(smoke!.TELEMETRY_DURABILITY_COVERAGE).toEqual({
      liveProjection: ['events', 'logs'],
      allRequiredReadiness: ['events', 'logs', 'agent-trace', 'node-io'],
      sharedMechanismStaticProof: ['agent-trace', 'node-io'],
    });
  });
});
