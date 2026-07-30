import { describe, expect, it } from 'bun:test';

import {
  FINDINGS_OPENSEARCH_DATABASE_URL_ENV,
  FINDINGS_OPENSEARCH_DEFAULT_PIT_HOLD_MS,
  FINDINGS_OPENSEARCH_MIN_RELEASE_PIT_HOLD_MS,
  FINDINGS_OPENSEARCH_RECOVERY_TIMEOUT_MS,
  FINDINGS_OPENSEARCH_CLEANUP_TIMEOUT_MS,
  FINDINGS_OPENSEARCH_CLEANUP_DRAIN_TIMEOUT_MS,
  FINDINGS_OPENSEARCH_CLOSE_TIMEOUT_MS,
  FINDINGS_OPENSEARCH_STANDALONE_TIMEOUT_MS,
  FINDINGS_OPENSEARCH_TENANT_REQUEST_TIMEOUT_MS,
  FINDINGS_OPENSEARCH_TENANT_SERVER_COMPLETION_BOUND_MS,
  FINDINGS_OPENSEARCH_WORK_DRAIN_TIMEOUT_MS,
  FINDINGS_OPENSEARCH_WORK_TIMEOUT_MS,
  FindingsOpenSearchResourceLedger,
  assertExactDiscoveryCoverage,
  assertExactBulkDeleteResponse,
  assertExactMgetDeletionResponse,
  assertCompleteOpenSearchResponse,
  assertSupportedOpenSearchVersion,
  buildCustomAnalyticsIsolationFixture,
  buildFindingsCorpusFixtures,
  buildFindingsCleanupStatements,
  buildLargeFindingsFixtures,
  calculateServerCompletionBarrierDelay,
  chunkExactOpenSearchIndexNames,
  createAbortableOpenSearchClient,
  createReferencedAbortScope,
  executeAbortablePostgresTransaction,
  executeConnectedAbortablePostgresTransaction,
  executeExactCleanupOperations,
  executeFindingsCleanupStages,
  executeFindingsOpenSearchAcceptancePlan,
  executeInvariantDriftProbe,
  executeTwoConsecutiveZeroPasses,
  installAndCaptureGlobalFindingsBootstrap,
  redactOpenSearchTarget,
  restoreGlobalFindingsBootstrapSnapshot,
  resolveFindingsOpenSearchAcceptanceConfig,
  sleepWithAbort,
  verifyInjectedOpenSearchFailureSemantics,
  waitForAmbiguousServerCompletion,
} from '../findings-opensearch-acceptance';

const DATABASE_URL =
  'postgresql://findings-smoke:database-secret@postgres.internal:5432/sentris_release';
const OPENSEARCH_URL = 'https://search-user:search-secret@opensearch.internal:9200';

function allowedEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    CI: 'true',
    SENTRIS_INSTANCE: '4',
    COMPOSE_PROJECT_NAME: 'sentris-production-smoke-4',
    SENTRIS_FINDINGS_OPENSEARCH_DISPOSABLE_PROJECT: 'true',
    FINDINGS_OPENSEARCH_SMOKE_API_BASE_URL: 'http://backend:3211/api/v1',
    FINDINGS_OPENSEARCH_SMOKE_INTERNAL_TOKEN: 'release-internal-token',
    FINDINGS_OPENSEARCH_SMOKE_OPENSEARCH_URL: OPENSEARCH_URL,
    [FINDINGS_OPENSEARCH_DATABASE_URL_ENV]: DATABASE_URL,
    ...overrides,
  };
}

describe('findings OpenSearch acceptance guard', () => {
  it('installs a clean global bootstrap before capturing and exactly restores that baseline', async () => {
    const calls: string[] = [];
    let pipelineId = '';
    let pipeline: Record<string, unknown> | undefined;
    let template: Record<string, unknown> | undefined;
    const client = {
      ingest: {
        async putPipeline(input: { id: string; body: Record<string, unknown> }) {
          calls.push('pipeline-put');
          pipelineId = input.id;
          pipeline = structuredClone(input.body);
          return { body: { acknowledged: true } };
        },
        async getPipeline() {
          calls.push('pipeline-get');
          return { body: pipeline ? { [pipelineId]: pipeline } : {} };
        },
      },
      indices: {
        async putIndexTemplate(input: { body: Record<string, unknown> }) {
          calls.push('template-put');
          template = structuredClone(input.body);
          return { body: { acknowledged: true } };
        },
        async getIndexTemplate() {
          calls.push('template-get');
          return {
            body: {
              index_templates: template
                ? [{ name: 'security-findings-template', index_template: template }]
                : [],
            },
          };
        },
      },
    };

    const snapshot = await installAndCaptureGlobalFindingsBootstrap(client as never);
    expect(calls.slice(0, 4)).toEqual([
      'pipeline-put',
      'template-put',
      'pipeline-get',
      'template-get',
    ]);
    const canonicalPipeline = structuredClone(snapshot.pipeline);
    const canonicalTemplate = structuredClone(snapshot.template);
    pipeline = { description: 'drifted' };
    template = { index_patterns: ['drifted-*'] };

    await restoreGlobalFindingsBootstrapSnapshot(client as never, snapshot);

    expect(pipeline).toEqual(canonicalPipeline);
    expect(template).toEqual(canonicalTemplate);
  });

  it('requires an explicit supported instance even when every target override is present', () => {
    expect(() =>
      resolveFindingsOpenSearchAcceptanceConfig(
        allowedEnvironment({ SENTRIS_INSTANCE: undefined }),
      ),
    ).toThrow('SENTRIS_INSTANCE must be set explicitly');
    expect(() =>
      resolveFindingsOpenSearchAcceptanceConfig(allowedEnvironment({ SENTRIS_INSTANCE: '10' })),
    ).toThrow('SENTRIS_INSTANCE must be an integer from 0 to 9');
  });

  it('requires CI or its dedicated destructive opt-in', () => {
    expect(() =>
      resolveFindingsOpenSearchAcceptanceConfig(
        allowedEnvironment({
          CI: undefined,
          SENTRIS_ALLOW_FINDINGS_OPENSEARCH_SMOKE: undefined,
        }),
      ),
    ).toThrow('Findings OpenSearch acceptance is destructive');

    const config = resolveFindingsOpenSearchAcceptanceConfig(
      allowedEnvironment({
        CI: undefined,
        SENTRIS_ALLOW_FINDINGS_OPENSEARCH_SMOKE: 'true',
        FINDINGS_OPENSEARCH_SMOKE_PIT_HOLD_MS: '25',
      }),
    );
    expect(config.instance).toBe('4');
    expect(config.pitHoldMs).toBe(25);
  });

  it('requires an explicitly disposable Compose project and every live target', () => {
    for (const key of [
      'COMPOSE_PROJECT_NAME',
      'FINDINGS_OPENSEARCH_SMOKE_API_BASE_URL',
      'FINDINGS_OPENSEARCH_SMOKE_INTERNAL_TOKEN',
      'FINDINGS_OPENSEARCH_SMOKE_OPENSEARCH_URL',
      FINDINGS_OPENSEARCH_DATABASE_URL_ENV,
    ]) {
      expect(() =>
        resolveFindingsOpenSearchAcceptanceConfig(allowedEnvironment({ [key]: undefined })),
      ).toThrow(key);
    }
    expect(() =>
      resolveFindingsOpenSearchAcceptanceConfig(
        allowedEnvironment({ SENTRIS_FINDINGS_OPENSEARCH_DISPOSABLE_PROJECT: undefined }),
      ),
    ).toThrow('SENTRIS_FINDINGS_OPENSEARCH_DISPOSABLE_PROJECT=true');
  });

  it('uses the script-specific local-runtime database target and redacts both live targets', () => {
    const config = resolveFindingsOpenSearchAcceptanceConfig(
      allowedEnvironment({
        DATABASE_URL: 'postgresql://wrong:wrong@wrong.invalid:5432/wrong',
      }),
    );

    expect(config.databaseTarget.source).toBe(`env:${FINDINGS_OPENSEARCH_DATABASE_URL_ENV}`);
    expect(config.databaseTarget.connectionString).toBe(DATABASE_URL);
    expect(config.databaseTarget.redactedConnectionString).not.toContain('database-secret');
    expect(config.databaseTarget.ignoredDatabaseUrl).toBe(true);
    expect(config.openSearchUrl).toBe(OPENSEARCH_URL);
    expect(config.redactedOpenSearchUrl).toBe('https://search-user:***@opensearch.internal:9200/');
    expect(config.apiBaseUrl).toBe('http://backend:3211/api/v1');
  });

  it('does not permit the release PIT lifetime leg to be shortened or skipped', () => {
    const defaultConfig = resolveFindingsOpenSearchAcceptanceConfig(allowedEnvironment());
    expect(FINDINGS_OPENSEARCH_DEFAULT_PIT_HOLD_MS).toBeGreaterThanOrEqual(125_000);
    expect(FINDINGS_OPENSEARCH_MIN_RELEASE_PIT_HOLD_MS).toBe(125_000);
    expect(defaultConfig.pitHoldMs).toBe(FINDINGS_OPENSEARCH_DEFAULT_PIT_HOLD_MS);

    expect(() =>
      resolveFindingsOpenSearchAcceptanceConfig(
        allowedEnvironment({ FINDINGS_OPENSEARCH_SMOKE_PIT_HOLD_MS: '124999' }),
      ),
    ).toThrow('release PIT hold must be at least 125000ms');
  });

  it('redacts OpenSearch credentials without hiding the selected host', () => {
    expect(redactOpenSearchTarget(OPENSEARCH_URL)).toBe(
      'https://search-user:***@opensearch.internal:9200/',
    );
    expect(redactOpenSearchTarget('http://opensearch:9200')).toBe('http://opensearch:9200/');
  });
});

describe('findings OpenSearch acceptance resource safety', () => {
  it('builds only exact parameterized PostgreSQL cleanup statements', () => {
    const ledger = new FindingsOpenSearchResourceLedger();
    ledger.trackOrganization('findings-smoke-primary');
    ledger.trackOrganization('findings-smoke-foreign');
    ledger.trackTriageRow('11111111-1111-4111-8111-111111111111');
    ledger.trackTriageRow('22222222-2222-4222-8222-222222222222');
    ledger.trackScope('33333333-3333-4333-8333-333333333333');
    ledger.trackWorkflowRun('findings-smoke-run-primary');
    ledger.trackWorkflow('44444444-4444-4444-8444-444444444444');
    ledger.trackAuditRow('55555555-5555-4555-8555-555555555555');
    ledger.trackOutboxEvent('66666666-6666-4666-8666-666666666666');

    const statements = buildFindingsCleanupStatements(ledger.snapshot());
    expect(statements.map((statement) => statement.name)).toEqual([
      'audit logs',
      'outbox events',
      'finding triage',
      'workflow runs',
      'scopes',
      'workflows',
      'projection reconciliation',
    ]);

    for (const statement of statements) {
      expect(statement.sql).toMatch(/\bWHERE\b/i);
      expect(statement.sql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
      expect(statement.sql).not.toMatch(/\bLIKE\b/i);
      expect(statement.sql).not.toContain('*');
      expect(statement.params).toHaveLength(1);
    }
    expect(statements[0]?.params[0]).toEqual(['55555555-5555-4555-8555-555555555555']);
    expect(statements[1]?.params[0]).toEqual(['66666666-6666-4666-8666-666666666666']);
    expect(statements[2]?.params[0]).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(statements[3]?.params[0]).toEqual(['findings-smoke-run-primary']);
    expect(statements[6]?.params[0]).toEqual(['findings-smoke-primary', 'findings-smoke-foreign']);
  });

  it('tracks exact OpenSearch resources and document IDs without patterns', () => {
    const ledger = new FindingsOpenSearchResourceLedger();
    ledger.trackOrganization('findings-smoke-primary');
    ledger.trackIndex('security-findings-oabc-observations-v1');
    ledger.trackIndexTemplate('sentris-findings-observation-oabc-hash-hash');
    ledger.trackDocument('security-findings-oabc-observations-v1', 'fo_v1_abc');

    const snapshot = ledger.snapshot();
    expect(snapshot).toMatchObject({
      indexTemplateNames: ['sentris-findings-observation-oabc-hash-hash'],
      documents: [
        {
          indexName: 'security-findings-oabc-observations-v1',
          documentId: 'fo_v1_abc',
        },
      ],
    });
    expect(snapshot.indexNames).toEqual([
      expect.stringMatching(/^sentris-internal-finding-projection-o[a-f0-9]{64}$/),
      'security-findings-oabc-observations-v1',
    ]);
    expect(() => ledger.trackIndex('security-findings-*')).toThrow('wildcard');
    expect(() => ledger.trackIndexTemplate('_all')).toThrow('wildcard');
  });

  it('requires exact, complete OpenSearch bulk and mget deletion proofs', () => {
    const indexName = 'security-findings-oabc-observations-v1';
    const documentIds = ['fo_v1_abc', 'fo_v1_def'];
    const bulkResponse = {
      body: {
        errors: false,
        items: [
          { delete: { _index: indexName, _id: documentIds[0], status: 200 } },
          { delete: { _index: indexName, _id: documentIds[1], status: 404 } },
        ],
      },
    };
    const mgetResponse = {
      body: {
        docs: [
          { _index: indexName, _id: documentIds[1], found: false },
          { _index: indexName, _id: documentIds[0], found: false },
        ],
      },
    };

    expect(() => assertExactBulkDeleteResponse(bulkResponse, indexName, documentIds)).not.toThrow();
    expect(() =>
      assertExactMgetDeletionResponse(mgetResponse, indexName, documentIds),
    ).not.toThrow();
    expect(() =>
      assertExactBulkDeleteResponse(
        { body: { errors: false, items: bulkResponse.body.items.slice(0, 1) } },
        indexName,
        documentIds,
      ),
    ).toThrow('one exact item per document');
    expect(() =>
      assertExactMgetDeletionResponse({ body: { docs: [] } }, indexName, documentIds),
    ).toThrow('one exact document per requested ID');
    expect(() =>
      assertExactMgetDeletionResponse(
        {
          body: {
            docs: [
              { _index: indexName, _id: documentIds[0], found: false },
              { _index: indexName, _id: documentIds[1], found: true },
            ],
          },
        },
        indexName,
        documentIds,
      ),
    ).toThrow('still exists');
  });

  it('attempts every exact cleanup operation and aggregates independent failures', async () => {
    const attempted: string[] = [];
    let caught: unknown;
    try {
      await executeExactCleanupOperations('fixture cleanup', [
        async () => {
          attempted.push('first');
          throw new Error('first failed');
        },
        async () => {
          attempted.push('second');
        },
        async () => {
          attempted.push('third');
          throw new Error('third failed');
        },
      ]);
    } catch (error) {
      caught = error;
    }

    expect(attempted).toEqual(['first', 'second', 'third']);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
      'first failed',
      'third failed',
    ]);
  });

  it('chunks long exact OpenSearch index targets below the bounded request count', () => {
    const indexNames = Array.from(
      { length: 105 },
      (_, index) =>
        `security-findings-${index.toString().padStart(3, '0')}-${'a'.repeat(180)}-observations-v1`,
    );

    const chunks = chunkExactOpenSearchIndexNames(indexNames);

    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 8)).toBe(true);
    expect(chunks.flat()).toEqual(indexNames);
    expect(new Set(chunks.flat()).size).toBe(indexNames.length);
  });

  it('continues exact OpenSearch and PostgreSQL cleanup when DB-owned-row discovery fails', async () => {
    const operations: string[] = [];
    let caught: unknown;
    try {
      await executeFindingsCleanupStages({
        discoverOwnedDatabaseRows: async () => {
          operations.push('discover');
          throw new Error('DB discovery failed');
        },
        snapshot: () => ({ token: 'ledgered' }),
        cleanupOpenSearchResources: async (manifest) => {
          operations.push(`opensearch:${manifest.token}`);
        },
        cleanupDatabaseResources: async (manifest) => {
          operations.push(`database:${manifest.token}`);
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(operations).toEqual(['discover', 'opensearch:ledgered', 'database:ledgered']);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('DB discovery failed');
  });

  it('requires two separated exact zero passes for late audit/outbox quiescence', async () => {
    const operations: string[] = [];
    let pass = 0;
    await executeTwoConsecutiveZeroPasses(
      async () => {
        pass += 1;
        operations.push(`pass-${pass}`);
        if (pass === 1) throw new Error('late audit row arrived');
      },
      async () => {
        operations.push('wait');
      },
      new AbortController().signal,
    );

    expect(operations).toEqual(['pass-1', 'wait', 'pass-2', 'wait', 'pass-3']);
  });

  it('rolls back an aborted PostgreSQL cleanup before scheduling another statement', async () => {
    const controller = new AbortController();
    const queries: string[] = [];
    const client = {
      query: async (query: string | { text: string }) => {
        const text = typeof query === 'string' ? query : query.text;
        queries.push(text);
        if (text === 'DELETE first') controller.abort(new Error('cleanup deadline expired'));
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };

    await expect(
      executeAbortablePostgresTransaction(
        client as never,
        [
          { name: 'first', sql: 'DELETE first', params: [[]] },
          { name: 'second', sql: 'DELETE second', params: [[]] },
        ],
        controller.signal,
      ),
    ).rejects.toThrow('cleanup deadline expired');

    expect(queries).toEqual(['BEGIN', 'DELETE first', 'ROLLBACK']);
  });

  it('checks cancellation after PostgreSQL connect before scheduling BEGIN or fixture writes', async () => {
    const controller = new AbortController();
    const queries: unknown[] = [];
    const releases: unknown[] = [];
    const client = {
      query: async (query: unknown) => {
        queries.push(query);
        return { rows: [], rowCount: 0 };
      },
      release: (destroy?: boolean) => releases.push(destroy),
    };
    const pool = {
      async connect() {
        controller.abort(new Error('phase expired during connect'));
        return client;
      },
    };

    await expect(
      executeConnectedAbortablePostgresTransaction(
        pool as never,
        [{ name: 'fixture', sql: 'INSERT fixture', params: [] }],
        controller.signal,
      ),
    ).rejects.toThrow('phase expired during connect');
    expect(queries).toEqual([]);
    expect(releases).toEqual([undefined]);
  });

  it('destroys the PostgreSQL client when bounded rollback fails', async () => {
    const controller = new AbortController();
    const released: boolean[] = [];
    const client = {
      query: async (query: string | { text: string }) => {
        const text = typeof query === 'string' ? query : query.text;
        if (text === 'DELETE first') controller.abort(new Error('cleanup deadline expired'));
        if (text === 'ROLLBACK') throw new Error('rollback connection failure');
        return { rows: [], rowCount: 0 };
      },
      release: (destroy: boolean) => released.push(destroy),
    };

    const result = executeAbortablePostgresTransaction(
      client as never,
      [{ name: 'first', sql: 'DELETE first', params: [[]] }],
      controller.signal,
    ).catch((error: unknown) => error);

    const error = await result;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect(released).toEqual([true]);
  });

  it('does not settle or permit a later pass until a timed-out rollback settles after destruction', async () => {
    const controller = new AbortController();
    const released: boolean[] = [];
    let rejectRollback: ((error: Error) => void) | undefined;
    const client = {
      query: async (query: string | { text: string }) => {
        const text = typeof query === 'string' ? query : query.text;
        if (text === 'DELETE first') controller.abort(new Error('cleanup deadline expired'));
        if (text === 'ROLLBACK') {
          return new Promise((_resolve, reject) => {
            rejectRollback = reject;
          });
        }
        return { rows: [], rowCount: 0 };
      },
      release: (destroy: boolean) => released.push(destroy),
    };

    let settled = false;
    const result = executeAbortablePostgresTransaction(
      client as never,
      [{ name: 'first', sql: 'DELETE first', params: [[]] }],
      controller.signal,
      10,
    ).then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(released).toEqual([true]);
    expect(settled).toBe(false);

    rejectRollback?.(new Error('connection destroyed'));
    const error = await result;
    expect(error).toBeInstanceOf(AggregateError);
    expect(settled).toBe(true);
    expect(released).toEqual([true]);
  });
});

describe('findings OpenSearch acceptance operation plan', () => {
  it('runs every acceptance phase in order and always performs exact cleanup', async () => {
    const operations: string[] = [];

    await executeFindingsOpenSearchAcceptancePlan({
      verifyTopologyAndBootstrap: async () => operations.push('topology/bootstrap'),
      verifyFirstUseAndCorpus: async () => operations.push('first-use/corpus'),
      verifyDriftAndFailureSemantics: async () => operations.push('drift/failures'),
      verifyLargeReadModels: async () => operations.push('large read models'),
      verifyPitAndDiscovery: async () => operations.push('PIT/discovery'),
      cleanup: async () => operations.push('cleanup'),
    });

    expect(operations).toEqual([
      'topology/bootstrap',
      'first-use/corpus',
      'drift/failures',
      'large read models',
      'PIT/discovery',
      'cleanup',
    ]);
  });

  it('stops on the first failed phase and still reports an independent cleanup failure', async () => {
    const operations: string[] = [];
    let caught: unknown;
    try {
      await executeFindingsOpenSearchAcceptancePlan({
        verifyTopologyAndBootstrap: async () => operations.push('topology/bootstrap'),
        verifyFirstUseAndCorpus: async () => {
          operations.push('first-use/corpus');
          throw new Error('corpus classification mismatch');
        },
        verifyDriftAndFailureSemantics: async () => operations.push('drift/failures'),
        verifyLargeReadModels: async () => operations.push('large read models'),
        verifyPitAndDiscovery: async () => operations.push('PIT/discovery'),
        cleanup: async () => {
          operations.push('cleanup');
          throw new Error('exact cleanup verification failed');
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
      'corpus classification mismatch',
      'exact cleanup verification failed',
    ]);
    expect(operations).toEqual(['topology/bootstrap', 'first-use/corpus', 'cleanup']);
  });

  it('reserves cleanup headroom and aborts a timed-out phase before exact cleanup', async () => {
    expect(
      FINDINGS_OPENSEARCH_WORK_TIMEOUT_MS +
        FINDINGS_OPENSEARCH_WORK_DRAIN_TIMEOUT_MS +
        FINDINGS_OPENSEARCH_CLEANUP_TIMEOUT_MS +
        FINDINGS_OPENSEARCH_CLEANUP_DRAIN_TIMEOUT_MS +
        FINDINGS_OPENSEARCH_CLOSE_TIMEOUT_MS,
    ).toBeLessThan(FINDINGS_OPENSEARCH_STANDALONE_TIMEOUT_MS);
    expect(FINDINGS_OPENSEARCH_STANDALONE_TIMEOUT_MS).toBeLessThan(1_470_000);
    expect(FINDINGS_OPENSEARCH_TENANT_SERVER_COMPLETION_BOUND_MS).toBeLessThan(
      FINDINGS_OPENSEARCH_TENANT_REQUEST_TIMEOUT_MS,
    );
    expect(FINDINGS_OPENSEARCH_TENANT_REQUEST_TIMEOUT_MS).toBeLessThan(
      FINDINGS_OPENSEARCH_WORK_DRAIN_TIMEOUT_MS,
    );
    expect(FINDINGS_OPENSEARCH_RECOVERY_TIMEOUT_MS + 10_000 + 15_000 + 5_000).toBeLessThan(
      FINDINGS_OPENSEARCH_WORK_DRAIN_TIMEOUT_MS,
    );
    expect(calculateServerCompletionBarrierDelay(10_000, 15_000, 85_000)).toBe(80_000);
    expect(calculateServerCompletionBarrierDelay(10_000, 95_000, 85_000)).toBe(0);

    const barrierDelays: number[] = [];
    await waitForAmbiguousServerCompletion(
      10_000,
      85_000,
      () => 15_000,
      async (delayMs) => {
        barrierDelays.push(delayMs);
      },
    );
    expect(barrierDelays).toEqual([80_000]);

    const operations: string[] = [];
    await expect(
      executeFindingsOpenSearchAcceptancePlan(
        {
          verifyTopologyAndBootstrap: (signal) =>
            new Promise<void>((_resolve, reject) => {
              operations.push('topology/bootstrap');
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            }),
          verifyFirstUseAndCorpus: async () => operations.push('first-use/corpus'),
          verifyDriftAndFailureSemantics: async () => operations.push('drift/failures'),
          verifyLargeReadModels: async () => operations.push('large read models'),
          verifyPitAndDiscovery: async () => operations.push('PIT/discovery'),
          cleanup: async (signal) => {
            signal.throwIfAborted();
            operations.push('cleanup');
          },
        },
        {
          phaseTimeoutMs: {
            verifyTopologyAndBootstrap: 5,
          },
          workTimeoutMs: 50,
          workDrainTimeoutMs: 10,
          cleanupTimeoutMs: 25,
          cleanupDrainTimeoutMs: 5,
          closeTimeoutMs: 5,
          totalTimeoutMs: 100,
        },
      ),
    ).rejects.toThrow('topology/bootstrap exceeded its 5ms cooperative deadline');
    expect(operations).toEqual(['topology/bootstrap', 'cleanup']);
  });

  it('aborts an in-flight SDK request and refuses to race cleanup with non-cooperative work', async () => {
    const controller = new AbortController();
    let rejectRequest: ((error: unknown) => void) | undefined;
    let abortCalls = 0;
    const request = Object.assign(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
      {
        abort() {
          abortCalls += 1;
          rejectRequest?.(new Error('transport aborted'));
        },
      },
    );
    const rawClient = { search: () => request };
    const client = createAbortableOpenSearchClient(rawClient, () => controller.signal);
    const pending = client.search();
    controller.abort(new Error('phase deadline'));

    await expect(pending).rejects.toThrow('transport aborted');
    expect(abortCalls).toBe(1);

    const operations: string[] = [];
    const result = executeFindingsOpenSearchAcceptancePlan(
      {
        verifyTopologyAndBootstrap: async () => new Promise(() => undefined),
        verifyFirstUseAndCorpus: async () => undefined,
        verifyDriftAndFailureSemantics: async () => undefined,
        verifyLargeReadModels: async () => undefined,
        verifyPitAndDiscovery: async () => undefined,
        cleanup: async () => operations.push('cleanup'),
      },
      {
        phaseTimeoutMs: { verifyTopologyAndBootstrap: 5 },
        workTimeoutMs: 50,
        workDrainTimeoutMs: 10,
        cleanupTimeoutMs: 25,
        cleanupDrainTimeoutMs: 5,
        closeTimeoutMs: 5,
        totalTimeoutMs: 100,
      },
    ).catch((error: unknown) => error);

    const error = await result;
    expect(error).toBeInstanceOf(AggregateError);
    expect(
      (error as AggregateError).errors.some((candidate) =>
        (candidate as Error).message.includes('did not settle within 10ms after abort'),
      ),
    ).toBe(true);
    expect(operations).toEqual([]);
  });

  it('makes the long PIT hold cooperatively abortable', async () => {
    const controller = new AbortController();
    const pending = sleepWithAbort(60_000, controller.signal);
    controller.abort(new Error('PIT phase expired'));

    await expect(pending).rejects.toThrow('PIT phase expired');
  });

  it('uses a referenced timeout and disposes it without a late abort', async () => {
    const expiringScope = createReferencedAbortScope(5, 'test request');
    await new Promise<void>((resolve) => {
      expiringScope.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    expect(expiringScope.signal.reason).toBeInstanceOf(Error);
    expect((expiringScope.signal.reason as Error).message).toContain(
      'test request exceeded its 5ms deadline',
    );
    expiringScope.dispose();

    const disposedScope = createReferencedAbortScope(5, 'completed request');
    disposedScope.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(disposedScope.signal.aborted).toBe(false);
  });

  it('restores drift in finally, rejects the exact invariant failure, and proves recovery', async () => {
    const operations: string[] = [];
    await executeInvariantDriftProbe({
      label: 'pipeline',
      expectedFailureMessage:
        'Installed findings final pipeline content does not match its immutable ID',
      proveHealthy: async () => operations.push('healthy-before'),
      capturePreState: async () => {
        operations.push('capture');
        return { description: 'exact-before' };
      },
      mutate: async () => operations.push('mutate'),
      reconcile: async () => {
        operations.push('reconcile-drifted');
        throw new Error(
          'Installed findings final pipeline content does not match its immutable ID',
        );
      },
      assertCheckingDegraded: async () => operations.push('checking/degraded'),
      restore: async (state) => operations.push(`restore:${state.description}`),
      assertRestored: async () => operations.push('restored-exactly'),
      proveRecovered: async () => operations.push('healthy-after'),
    });

    expect(operations).toEqual([
      'healthy-before',
      'capture',
      'mutate',
      'reconcile-drifted',
      'checking/degraded',
      'restore:exact-before',
      'restored-exactly',
      'healthy-after',
    ]);

    const wrongFailureOperations: string[] = [];
    await expect(
      executeInvariantDriftProbe({
        label: 'mapping',
        expectedFailureMessage:
          'Installed findings observation mapping does not match the contract',
        proveHealthy: async () => wrongFailureOperations.push('healthy-before'),
        capturePreState: async () => ({ dynamic: false }),
        mutate: async () => wrongFailureOperations.push('mutate'),
        reconcile: async () => {
          throw new Error('arbitrary transport exception');
        },
        assertCheckingDegraded: async () => wrongFailureOperations.push('checking/degraded'),
        restore: async () => wrongFailureOperations.push('restore'),
        assertRestored: async () => wrongFailureOperations.push('restored-exactly'),
        proveRecovered: async () => wrongFailureOperations.push('healthy-after'),
      }),
    ).rejects.toThrow('mapping drift returned unexpected failure');
    expect(wrongFailureOperations).toEqual([
      'healthy-before',
      'mutate',
      'restore',
      'restored-exactly',
      'healthy-after',
    ]);
  });

  it('finishes restoration and recovery on a fresh signal after drift phase abort', async () => {
    const phaseController = new AbortController();
    const recoveryController = new AbortController();
    const signalHolder = { signal: phaseController.signal };
    const operations: string[] = [];

    await expect(
      executeInvariantDriftProbe({
        label: 'mapping',
        expectedFailureMessage: 'mapping invariant mismatch',
        proveHealthy: async () => operations.push('healthy-before'),
        capturePreState: async () => ({ dynamic: false }),
        mutate: async () => operations.push('mutate'),
        reconcile: async () => {
          operations.push('reconcile');
          phaseController.abort(new Error('drift phase deadline'));
          throw new Error('mapping invariant mismatch');
        },
        assertCheckingDegraded: async () => operations.push('checking/degraded'),
        runRecovery: async (operation) => {
          const phaseSignal = signalHolder.signal;
          signalHolder.signal = recoveryController.signal;
          try {
            await operation();
          } finally {
            signalHolder.signal = phaseSignal;
          }
          phaseSignal.throwIfAborted();
        },
        restore: async () => {
          expect(signalHolder.signal.aborted).toBe(false);
          operations.push('restore');
        },
        assertRestored: async () => {
          expect(signalHolder.signal.aborted).toBe(false);
          operations.push('restored-exactly');
        },
        proveRecovered: async () => {
          expect(signalHolder.signal.aborted).toBe(false);
          operations.push('verified/available');
        },
      }),
    ).rejects.toThrow('drift phase deadline');

    expect(signalHolder.signal).toBe(phaseController.signal);
    expect(operations).toEqual([
      'healthy-before',
      'mutate',
      'reconcile',
      'checking/degraded',
      'restore',
      'restored-exactly',
      'verified/available',
    ]);
  });
});

describe('findings OpenSearch response contract', () => {
  it('accepts only the supported OpenSearch 2.11 topology', () => {
    expect(() => assertSupportedOpenSearchVersion('2.11.1')).not.toThrow();
    expect(() => assertSupportedOpenSearchVersion('2.12.0')).toThrow(
      'OpenSearch 2.11.x is required',
    );
    expect(() => assertSupportedOpenSearchVersion('3.0.0')).toThrow(
      'OpenSearch 2.11.x is required',
    );
  });

  it('rejects timed-out, partial, and malformed search responses instead of treating them as empty', () => {
    expect(() =>
      assertCompleteOpenSearchResponse(
        {
          timed_out: true,
          _shards: { total: 1, successful: 1, failed: 0 },
          hits: { hits: [] },
        },
        'timed-out probe',
      ),
    ).toThrow('timed-out probe returned an incomplete response');
    expect(() =>
      assertCompleteOpenSearchResponse(
        {
          timed_out: false,
          _shards: { total: 2, successful: 1, failed: 1 },
          hits: { hits: [] },
        },
        'partial probe',
      ),
    ).toThrow('partial probe returned an incomplete response');
    expect(() =>
      assertCompleteOpenSearchResponse(
        {
          timed_out: false,
          _shards: { total: 1, successful: 1, failed: 0 },
        },
        'malformed probe',
      ),
    ).toThrow('malformed probe returned a malformed response');
  });

  it('exercises the production query service for timeout, partial, and malformed responses', async () => {
    await expect(verifyInjectedOpenSearchFailureSemantics()).resolves.toEqual([
      'timed-out:unavailable',
      'partial:unavailable',
      'malformed:unavailable',
      'malformed-total:unavailable',
      'inexact-total-relation:unavailable',
      'malformed-discovery-bucket:unavailable',
    ]);
  });
});

describe('findings OpenSearch live corpus plan', () => {
  it('uses a custom analytics fixture with no canonical findings fields or mappings', () => {
    const fixture = buildCustomAnalyticsIsolationFixture('suite-123');

    expect(fixture.document).toEqual({
      arbitrary: { analytics: true, nested: ['retained', 7] },
      custom_score: 0.75,
    });
    expect(fixture.mapping).toEqual({
      dynamic: 'strict',
      properties: {
        arbitrary: { type: 'object', enabled: false },
        custom_score: { type: 'float' },
      },
    });
    expect(JSON.stringify(fixture)).not.toContain('sentris_contract_classification');
    expect(JSON.stringify(fixture)).not.toContain('sentris_normalized_severity');
  });

  it('covers canonical, legacy, invalid, forged-ID, timestamp, and arbitrary evidence/source shapes', () => {
    const fixtures = buildFindingsCorpusFixtures({
      organizationId: 'findings-corpus-org',
      workflowId: 'findings-corpus-workflow',
      runId: 'findings-corpus-run',
      scopeId: '11111111-1111-4111-8111-111111111111',
      componentId: 'test.analytics.fixture',
      nodeRef: 'corpus-node',
    });

    expect(fixtures.map((fixture) => fixture.name)).toEqual([
      'canonical-object',
      'canonical-array',
      'canonical-scalar',
      'canonical-null',
      'marker-absent-legacy',
      'malformed-marker',
      'null-markers',
      'forged-document-id',
      'utc-timestamp',
      'offset-timestamp',
      'missing-required-field',
    ]);
    expect(fixtures.map((fixture) => fixture.expectedClassification)).toEqual([
      'canonical',
      'canonical',
      'canonical',
      'canonical',
      'legacy',
      'invalid',
      'invalid',
      'rejected',
      'canonical',
      'invalid',
      'invalid',
    ]);
    expect(fixtures.find((fixture) => fixture.name === 'canonical-array')?.document).toMatchObject({
      evidence: ['evidence-array', { nested: true }],
      source: ['source-array', 7],
    });
    expect(fixtures.find((fixture) => fixture.name === 'canonical-scalar')?.document).toMatchObject(
      {
        evidence: 'evidence-scalar',
        source: 42,
      },
    );
    expect(fixtures.find((fixture) => fixture.name === 'canonical-null')?.document).toMatchObject({
      evidence: null,
      source: null,
    });
    const forged = fixtures.find((fixture) => fixture.name === 'forged-document-id');
    expect(forged?.document.finding_id).not.toBe(forged?.documentId);
    expect(fixtures.find((fixture) => fixture.name === 'offset-timestamp')?.document).toMatchObject(
      {
        '@timestamp': '2026-07-29T12:34:56+02:00',
        observed_at: '2026-07-29T12:34:56+02:00',
      },
    );
  });

  it('builds more than 10,000 canonical observations with independently countable combined filters', () => {
    const fixtures = buildLargeFindingsFixtures({
      organizationId: 'findings-large-org',
      workflowId: '22222222-2222-4222-8222-222222222222',
      scopeId: '33333333-3333-4333-8333-333333333333',
      scopedRunId: 'findings-large-scoped-run',
      unscopedRunId: 'findings-large-unscoped-run',
      count: 10_001,
      now: new Date('2026-07-29T12:00:00.000Z'),
    });

    expect(fixtures).toHaveLength(10_001);
    expect(
      fixtures.every((fixture) => fixture.document.contract === 'sentris.finding-observation'),
    ).toBe(true);
    expect(new Set(fixtures.map((fixture) => fixture.documentId)).size).toBe(10_001);
    expect(
      fixtures.filter(
        (fixture) =>
          fixture.severity === 'critical' &&
          fixture.triageStatus === 'fixed' &&
          fixture.runId === 'findings-large-scoped-run' &&
          fixture.componentId === 'component-a',
      ),
    ).toHaveLength(167);
    expect(
      fixtures.filter((fixture) => fixture.runId === 'findings-large-scoped-run'),
    ).toHaveLength(5_001);
    expect(
      fixtures.filter((fixture) => fixture.organizationId !== 'findings-large-org'),
    ).toHaveLength(0);
  });

  it('requires exact, exactly-once discovery coverage with no omitted or extra tenants', () => {
    const expected = ['org-a', 'org-b', 'org-c'];
    expect(() => assertExactDiscoveryCoverage(expected, expected, 'restart/wrap')).not.toThrow();
    expect(() =>
      assertExactDiscoveryCoverage(['org-a', 'org-b', 'org-b', 'org-c'], expected, 'duplicate'),
    ).toThrow('duplicate');
    expect(() => assertExactDiscoveryCoverage(['org-a', 'org-c'], expected, 'omitted')).toThrow(
      'cardinality',
    );
    expect(() =>
      assertExactDiscoveryCoverage(['org-a', 'org-b', 'org-c', 'org-x'], expected, 'extra'),
    ).toThrow('cardinality');
  });
});
