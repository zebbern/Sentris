import { describe, expect, it } from 'bun:test';

import type {
  ClaimedOutboxEvent,
  OutboxRepositoryPort,
  RescheduleOutboxEventInput,
} from '../../src/outbox/outbox-dispatcher.service';
import {
  LIFECYCLE_DURABILITY_DATABASE_URL_ENV,
  LifecycleSmokeResourceLedger,
  buildLifecycleCleanupStatements,
  buildLifecyclePoolConfig,
  buildLifecycleResidualCountStatements,
  createLifecycleOutboxDispatcher,
  executeLifecycleSmokePlan,
  lifecycleSmokeDatabaseName,
  resolveLifecycleSmokeConfig,
} from '../lifecycle-durability-smoke';

const OVERRIDE_URL =
  'postgresql://smoke-user:smoke-secret@db.internal:5432/sentris_lifecycle_smoke_i4';

function allowedEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    CI: 'true',
    SENTRIS_INSTANCE: '4',
    [LIFECYCLE_DURABILITY_DATABASE_URL_ENV]: OVERRIDE_URL,
    ...overrides,
  };
}

describe('lifecycle durability smoke guard', () => {
  it('requires an explicitly selected instance even when a database override is present', () => {
    expect(() =>
      resolveLifecycleSmokeConfig(allowedEnvironment({ SENTRIS_INSTANCE: undefined })),
    ).toThrow('SENTRIS_INSTANCE must be set explicitly');
  });

  it('rejects an instance outside the supported numeric instance range', () => {
    expect(() =>
      resolveLifecycleSmokeConfig(allowedEnvironment({ SENTRIS_INSTANCE: '4x' })),
    ).toThrow('SENTRIS_INSTANCE must be an integer from 0 to 9');
    expect(() =>
      resolveLifecycleSmokeConfig(allowedEnvironment({ SENTRIS_INSTANCE: '10' })),
    ).toThrow('SENTRIS_INSTANCE must be an integer from 0 to 9');
  });

  it('requires CI or the dedicated destructive opt-in', () => {
    expect(() =>
      resolveLifecycleSmokeConfig(
        allowedEnvironment({
          CI: undefined,
          SENTRIS_ALLOW_LIFECYCLE_DURABILITY_SMOKE: undefined,
        }),
      ),
    ).toThrow('Lifecycle durability smoke is destructive');

    const config = resolveLifecycleSmokeConfig(
      allowedEnvironment({
        CI: undefined,
        SENTRIS_ALLOW_LIFECYCLE_DURABILITY_SMOKE: 'true',
      }),
    );
    expect(config.instance).toBe('4');
  });

  it('uses the script-specific local-runtime override and never exposes its password', () => {
    const config = resolveLifecycleSmokeConfig(
      allowedEnvironment({
        DATABASE_URL: 'postgresql://wrong:wrong@wrong.invalid:5432/wrong',
      }),
    );

    expect(config.databaseTarget.source).toBe(`env:${LIFECYCLE_DURABILITY_DATABASE_URL_ENV}`);
    expect(config.databaseTarget.connectionString).toBe(OVERRIDE_URL);
    expect(config.databaseTarget.redactedConnectionString).not.toContain('smoke-secret');
    expect(config.databaseTarget.redactedConnectionString).toContain('***');
    expect(config.databaseTarget.ignoredDatabaseUrl).toBe(true);
    expect(config.databaseTarget.databaseName).toBe('sentris_lifecycle_smoke_i4');
  });

  it('fails closed unless the target is the dedicated database for the selected instance', () => {
    expect(lifecycleSmokeDatabaseName('4')).toBe('sentris_lifecycle_smoke_i4');

    expect(() =>
      resolveLifecycleSmokeConfig(
        allowedEnvironment({
          [LIFECYCLE_DURABILITY_DATABASE_URL_ENV]:
            'postgresql://sentris:sentris@postgres:5432/sentris',
        }),
      ),
    ).toThrow('must target dedicated database sentris_lifecycle_smoke_i4');
    expect(() =>
      resolveLifecycleSmokeConfig(
        allowedEnvironment({
          [LIFECYCLE_DURABILITY_DATABASE_URL_ENV]:
            'postgresql://sentris:sentris@postgres:5432/sentris_lifecycle_smoke_i3',
        }),
      ),
    ).toThrow('must target dedicated database sentris_lifecycle_smoke_i4');
  });

  it('requires the script-specific override rather than a generic script target', () => {
    expect(() =>
      resolveLifecycleSmokeConfig(
        allowedEnvironment({
          [LIFECYCLE_DURABILITY_DATABASE_URL_ENV]: undefined,
          SENTRIS_SCRIPT_DATABASE_URL: OVERRIDE_URL,
        }),
      ),
    ).toThrow(`requires ${LIFECYCLE_DURABILITY_DATABASE_URL_ENV}`);
  });

  it('bounds connection, statement, query, transaction-idle, and lock waits', () => {
    const config = resolveLifecycleSmokeConfig(allowedEnvironment());
    const poolConfig = buildLifecyclePoolConfig(config);

    expect(poolConfig).toMatchObject({
      connectionString: OVERRIDE_URL,
      application_name: 'sentris-lifecycle-smoke-i4',
      max: 4,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 120_000,
      query_timeout: 130_000,
      lock_timeout: 10_000,
      idle_in_transaction_session_timeout: 30_000,
    });
  });
});

describe('lifecycle durability smoke cleanup', () => {
  it('builds only parameterized exact-ID cleanup statements from the resource ledger', () => {
    const ledger = new LifecycleSmokeResourceLedger([
      'lifecycle-smoke-org-primary',
      'lifecycle-smoke-org-foreign',
    ]);
    ledger.trackNotificationChannel('11111111-1111-4111-8111-111111111111');
    ledger.trackNotificationChannel('22222222-2222-4222-8222-222222222222');
    ledger.trackFindingTriage('33333333-3333-4333-8333-333333333333');
    ledger.trackTicketingConnection('44444444-4444-4444-8444-444444444444');

    const manifest = ledger.snapshot();
    expect(manifest).toEqual({
      organizationIds: ['lifecycle-smoke-org-primary', 'lifecycle-smoke-org-foreign'],
      notificationChannelIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      findingTriageIds: ['33333333-3333-4333-8333-333333333333'],
      ticketingConnectionIds: ['44444444-4444-4444-8444-444444444444'],
    });

    const statements = buildLifecycleCleanupStatements(manifest);
    expect(statements.map((statement) => statement.name)).toEqual([
      'notification deliveries',
      'notification channels',
      'ticket links',
      'finding triage',
      'ticketing connections',
      'audit logs',
      'outbox events',
    ]);

    for (const statement of statements) {
      expect(statement.sql).toMatch(/\bWHERE\b/i);
      expect(statement.sql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
      expect(statement.sql).not.toMatch(/\bLIKE\b/i);
      expect(statement.params).toHaveLength(1);
    }
    expect(statements[0]?.params[0]).toEqual(manifest.notificationChannelIds);
    expect(statements[2]?.params[0]).toEqual(manifest.findingTriageIds);
    expect(statements[4]?.params[0]).toEqual(manifest.ticketingConnectionIds);
    expect(statements[5]?.params[0]).toEqual(manifest.organizationIds);
    expect(statements[6]?.params[0]).toEqual(manifest.organizationIds);

    const residualStatements = buildLifecycleResidualCountStatements(manifest);
    expect(residualStatements.map((statement) => statement.name)).toEqual([
      'notification deliveries',
      'notification channels',
      'ticket links',
      'finding triage',
      'ticketing connections',
      'audit logs',
      'outbox events',
    ]);
    for (const statement of residualStatements) {
      expect(statement.sql).toMatch(/^SELECT COUNT\(\*\)::int AS count FROM /);
      expect(statement.sql).toMatch(/\bWHERE\b/i);
      expect(statement.sql).not.toMatch(/\bLIKE\b/i);
      expect(statement.params).toHaveLength(1);
    }
    expect(residualStatements[0]?.params[0]).toEqual(manifest.notificationChannelIds);
    expect(residualStatements[5]?.params[0]).toEqual(manifest.organizationIds);
  });
});

describe('lifecycle durability smoke operation order', () => {
  it('checks the schema before running audit, notification, and ticketing scenarios', async () => {
    const operations: string[] = [];

    await executeLifecycleSmokePlan({
      verifyCheckedSchema: async () => {
        operations.push('verify checked schema');
      },
      runAuditScenario: async () => {
        operations.push('audit');
      },
      runNotificationScenario: async () => {
        operations.push('notifications');
      },
      runTicketingScenario: async () => {
        operations.push('ticketing');
      },
      cleanup: async () => {
        operations.push('cleanup');
      },
    });

    expect(operations).toEqual([
      'verify checked schema',
      'audit',
      'notifications',
      'ticketing',
      'cleanup',
    ]);
  });

  it('stops at the first failed assertion and still performs exact cleanup', async () => {
    const operations: string[] = [];
    const failure = new Error('audit atomic rollback assertion failed');

    await expect(
      executeLifecycleSmokePlan({
        verifyCheckedSchema: async () => {
          operations.push('verify checked schema');
        },
        runAuditScenario: async () => {
          operations.push('audit');
          throw failure;
        },
        runNotificationScenario: async () => {
          operations.push('notifications');
        },
        runTicketingScenario: async () => {
          operations.push('ticketing');
        },
        cleanup: async () => {
          operations.push('cleanup');
        },
      }),
    ).rejects.toBe(failure);

    expect(operations).toEqual(['verify checked schema', 'audit', 'cleanup']);
  });

  it('reports both a scenario failure and a cleanup failure without hiding either', async () => {
    const operations: string[] = [];

    let caught: unknown;
    try {
      await executeLifecycleSmokePlan({
        verifyCheckedSchema: async () => {
          operations.push('verify checked schema');
        },
        runAuditScenario: async () => {
          operations.push('audit');
        },
        runNotificationScenario: async () => {
          operations.push('notifications');
          throw new Error('notification assertion failed');
        },
        runTicketingScenario: async () => {
          operations.push('ticketing');
        },
        cleanup: async () => {
          operations.push('cleanup');
          throw new Error('exact cleanup failed');
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
      'notification assertion failed',
      'exact cleanup failed',
    ]);
    expect(operations).toEqual(['verify checked schema', 'audit', 'notifications', 'cleanup']);
  });
});

describe('lifecycle durability outbox runtime', () => {
  it('uses reconstructed real dispatchers to claim, emit, dead-letter, requeue, and complete', async () => {
    let status: 'pending' | 'processing' | 'completed' | 'dead' = 'pending';
    let attempts = 0;
    let lastError: string | null = null;
    let failListener = true;
    let listenerCalls = 0;
    const event: Omit<ClaimedOutboxEvent, 'attempts'> = {
      id: '11111111-1111-4111-8111-111111111111',
      eventType: 'run.status.terminal',
      organizationId: 'lifecycle-smoke-org',
      aggregateType: 'workflow_run',
      aggregateId: 'lifecycle-smoke-run',
      dedupeKey: 'lifecycle-smoke-run:terminal',
      payload: {
        runId: 'lifecycle-smoke-run',
        workflowId: 'lifecycle-smoke-workflow',
        organizationId: 'lifecycle-smoke-org',
        status: 'FAILED',
      },
      maxAttempts: 1,
    };
    const repository: OutboxRepositoryPort & { requeue(): void } = {
      async claimBatch() {
        if (status !== 'pending') return [];
        status = 'processing';
        attempts += 1;
        return [{ ...event, attempts }];
      },
      async renewLease() {
        return status === 'processing';
      },
      async markCompleted() {
        status = 'completed';
        lastError = null;
      },
      async reschedule(_eventId: string, _workerId: string, input: RescheduleOutboxEventInput) {
        status = input.dead ? 'dead' : 'pending';
        lastError = input.error;
      },
      requeue() {
        status = 'pending';
        attempts = 0;
        lastError = null;
      },
    };
    const handleRunTerminal = async () => {
      listenerCalls += 1;
      if (failListener) throw new Error('injected provider ambiguity');
    };

    await createLifecycleOutboxDispatcher(repository, { handleRunTerminal }).drainOnce();
    expect({ status, attempts, lastError, listenerCalls }).toEqual({
      status: 'dead',
      attempts: 1,
      lastError: 'injected provider ambiguity',
      listenerCalls: 1,
    });

    repository.requeue();
    failListener = false;
    await createLifecycleOutboxDispatcher(repository, { handleRunTerminal }).drainOnce();
    expect({ status, attempts, lastError, listenerCalls }).toEqual({
      status: 'completed',
      attempts: 1,
      lastError: null,
      listenerCalls: 2,
    });
  });
});
