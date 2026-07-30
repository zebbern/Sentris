import { describe, expect, it } from 'bun:test';

type BrowserJourneyEnvironment = {
  SENTRIS_INSTANCE: string;
  SENTRIS_TRUST_PROFILE: 'trusted-local';
  SENTRIS_BROWSER_BASE_URL: string;
  SENTRIS_BROWSER_JOURNEY_HEADLESS: 'true' | 'false';
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  INTERNAL_SERVICE_TOKEN: string;
  COMPOSE_PROJECT_NAME: string;
};

type FixtureState = {
  scopeId?: string;
  scopeName?: string;
  workflowId?: string;
  workflowName?: string;
  seededRunIds: string[];
  assetIds: string[];
  launchAttempted?: boolean;
  browserRunId?: string;
  browserRunTerminal?: boolean;
  findingIds: string[];
};

type FixtureMaintenancePayload =
  | {
      action: 'seed';
      organizationId: string;
      workflowId: string;
      workflowVersionId: string;
      workflowVersion: number;
      scopeId: string;
      runs: Array<{ runId: string; createdAt: string }>;
      assets: Array<{
        id: string;
        assetType: string;
        assetValue: string;
        sourceRunId: string;
      }>;
    }
  | {
      action: 'cleanup';
      organizationId: string;
      runIds: string[];
      assetIds: string[];
      findingIds: string[];
    };

type JourneyHarness = {
  resolveBrowserJourneyEnvironment(input: NodeJS.ProcessEnv): BrowserJourneyEnvironment;
  buildBrowserFixtureWorkflow(name: string): {
    name: string;
    nodes: Array<{ id: string; type: string; data: { config: { params: unknown } } }>;
    edges: Array<{
      source: string;
      target: string;
      sourceHandle?: string;
      targetHandle?: string;
    }>;
  };
  buildOpenSearchFixtureCleanup(input: { organizationId: string; scopeId: string }): {
    index: string;
    body: { query: { bool: { filter: unknown[] } } };
  };
  buildDatabaseMaintenanceInvocation(
    env: BrowserJourneyEnvironment,
    payload: FixtureMaintenancePayload,
  ): {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    input: string;
  };
  createBrowserFixtureService(
    env: BrowserJourneyEnvironment,
    dependencies: {
      fetchImpl: typeof fetch;
      runDatabaseMaintenance(payload: FixtureMaintenancePayload): Promise<void>;
      runOpenSearchCleanup(request: { index: string; body: unknown }): Promise<void>;
      randomUuid(): string;
      now(): Date;
      sleep(): Promise<void>;
    },
  ): {
    state: FixtureState;
    setup(): Promise<void>;
    waitForRunAndProjections(runId: string): Promise<{ findingIds: string[] }>;
    cleanup(): Promise<void>;
  };
  runBrowserTargetJourneyLifecycle(input: {
    env: NodeJS.ProcessEnv;
    fixtureService: {
      state: FixtureState;
      setup(): Promise<void>;
      waitForRunAndProjections(runId: string): Promise<{ findingIds: string[] }>;
      cleanup(): Promise<void>;
    };
    createDriver(): Promise<{
      loginThroughLocalAdmin(): Promise<void>;
      openTargetFromList(): Promise<void>;
      launchScopedZeroInputWorkflow(): Promise<string>;
      proveRunHistoryPagination(): Promise<void>;
      openRunFromHistory(): Promise<void>;
      proveAssetTypeFilterAndSourceRun(): Promise<void>;
      proveScopeFindingDeepLinkAndTriage(): Promise<string>;
      proveRescanPreservesScope(): Promise<void>;
      close(): Promise<void>;
    }>;
  }): Promise<{ checkpoints: string[] }>;
};

let harness: JourneyHarness | undefined;
try {
  harness = require('../browser-target-journey.js') as JourneyHarness;
} catch {
  harness = undefined;
}

const validEnvironment: NodeJS.ProcessEnv = {
  CI: 'true',
  SENTRIS_INSTANCE: '7',
  SENTRIS_TRUST_PROFILE: 'trusted-local',
  SENTRIS_BROWSER_BASE_URL: 'http://127.0.0.1:8088',
  SENTRIS_BROWSER_JOURNEY_HEADLESS: 'true',
  ADMIN_USERNAME: 'release-admin',
  ADMIN_PASSWORD: 'release-password',
  INTERNAL_SERVICE_TOKEN: 'release-internal-token',
  COMPOSE_PROJECT_NAME: 'sentris-production-smoke-7',
};

describe('real-browser target journey release harness', () => {
  it('fails closed without an explicit instance, trusted-local profile, or destructive context', () => {
    expect(harness).toBeDefined();
    const resolve = harness!.resolveBrowserJourneyEnvironment;

    expect(() =>
      resolve({
        ...validEnvironment,
        SENTRIS_INSTANCE: undefined,
      }),
    ).toThrow('SENTRIS_INSTANCE must be set explicitly');
    expect(() =>
      resolve({
        ...validEnvironment,
        SENTRIS_INSTANCE: '-1',
      }),
    ).toThrow('SENTRIS_INSTANCE must be a non-negative integer');
    expect(() =>
      resolve({
        ...validEnvironment,
        SENTRIS_TRUST_PROFILE: 'hardened',
      }),
    ).toThrow('requires SENTRIS_TRUST_PROFILE=trusted-local');
    expect(() =>
      resolve({
        ...validEnvironment,
        CI: undefined,
        SENTRIS_ALLOW_PRODUCTION_BROWSER_JOURNEY: undefined,
      }),
    ).toThrow('destructive');
  });

  it('requires the real local-admin and instance-bound maintenance inputs', () => {
    const resolve = harness!.resolveBrowserJourneyEnvironment;

    for (const missing of [
      'ADMIN_USERNAME',
      'ADMIN_PASSWORD',
      'INTERNAL_SERVICE_TOKEN',
      'COMPOSE_PROJECT_NAME',
    ] as const) {
      expect(() =>
        resolve({
          ...validEnvironment,
          [missing]: ' ',
        }),
      ).toThrow(missing);
    }

    expect(
      resolve({
        ...validEnvironment,
        CI: undefined,
        SENTRIS_ALLOW_PRODUCTION_BROWSER_JOURNEY: 'true',
        SENTRIS_BROWSER_JOURNEY_HEADLESS: 'false',
      }),
    ).toMatchObject({
      SENTRIS_INSTANCE: '7',
      SENTRIS_TRUST_PROFILE: 'trusted-local',
      SENTRIS_BROWSER_BASE_URL: 'http://127.0.0.1:8088',
      SENTRIS_BROWSER_JOURNEY_HEADLESS: 'false',
    });
  });

  it('builds a zero-runtime-input workflow that indexes deterministic findings', () => {
    const workflow = harness!.buildBrowserFixtureWorkflow('Browser fixture workflow');
    const entrypoint = workflow.nodes.find((node) => node.type === 'core.workflow.entrypoint');

    expect(workflow.name).toBe('Browser fixture workflow');
    expect(entrypoint?.data.config.params).toEqual({ runtimeInputs: [] });
    expect(workflow.nodes.map((node) => node.type)).toEqual([
      'core.workflow.entrypoint',
      'test.analytics.fixture',
      'core.analytics.sink',
    ]);
    expect(workflow.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'fixture',
          target: 'sink',
          sourceHandle: 'results',
          targetHandle: 'results',
        }),
      ]),
    );
  });

  it('builds scope-bound OpenSearch cleanup', () => {
    const openSearch = harness!.buildOpenSearchFixtureCleanup({
      organizationId: 'local-dev',
      scopeId: '00000000-0000-4000-8000-000000000021',
    });
    expect(openSearch.index).toMatch(/^security-findings-o[a-f0-9]{64}-observations-v1$/);
    expect(openSearch.body.query.bool.filter).toEqual([
      { term: { 'sentris.organization_id': 'local-dev' } },
      { term: { 'sentris.scope_id': '00000000-0000-4000-8000-000000000021' } },
    ]);
  });

  it('invokes the guarded TypeScript maintenance helper inside the backend container', () => {
    const payload: FixtureMaintenancePayload = {
      action: 'cleanup',
      organizationId: 'local-dev',
      runIds: ['seed-run-1'],
      assetIds: [],
      findingIds: [],
    };
    const invocation = harness!.buildDatabaseMaintenanceInvocation(
      harness!.resolveBrowserJourneyEnvironment(validEnvironment),
      payload,
    );

    expect(invocation.command).toBe('docker');
    expect(invocation.args).toEqual([
      'compose',
      '-f',
      'docker/docker-compose.full.yml',
      'exec',
      '-T',
      '-e',
      'BROWSER_TARGET_FIXTURE_DATABASE_URL',
      'backend',
      'bun',
      'scripts/browser-target-fixture-maintenance.ts',
      'cleanup',
    ]);
    expect(invocation.args).not.toContain('psql');
    expect(invocation.env.SENTRIS_INSTANCE).toBe('7');
    expect(invocation.env.BROWSER_TARGET_FIXTURE_DATABASE_URL).toBe(
      'postgresql://sentris:sentris@postgres:5432/sentris',
    );
    expect(JSON.parse(invocation.input)).toEqual(payload);
  });

  it('sets up deterministic fixtures, waits for the browser run, and cleans exact IDs', async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const databaseMaintenance: FixtureMaintenancePayload[] = [];
    const openSearchCleanup: Array<{ index: string; body: unknown }> = [];
    let uuidCounter = 30;
    const uuid = () => `00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, '0')}`;
    const scopeId = '00000000-0000-4000-8000-000000000100';
    const workflowId = '00000000-0000-4000-8000-000000000101';
    const workflowVersionId = '00000000-0000-4000-8000-000000000102';
    const findingId = `fo_v1_${'b'.repeat(64)}`;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      requests.push({ method, path: `${url.pathname}${url.search}` });

      if (method === 'POST' && url.pathname.endsWith('/scopes')) {
        return Response.json({ id: scopeId }, { status: 201 });
      }
      if (method === 'POST' && url.pathname.endsWith('/workflows')) {
        return Response.json(
          {
            id: workflowId,
            currentVersionId: workflowVersionId,
            currentVersion: 1,
          },
          { status: 201 },
        );
      }
      if (method === 'GET' && url.pathname.endsWith('/workflows/runs/browser-run/status')) {
        return Response.json({ status: 'COMPLETED' });
      }
      if (method === 'GET' && url.pathname.endsWith('/findings')) {
        return Response.json({
          availability: 'available',
          items: [{ id: findingId, run_id: 'browser-run', scope_id: scopeId }],
        });
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ message: 'unexpected request' }, { status: 500 });
    }) as typeof fetch;

    const service = harness!.createBrowserFixtureService(
      harness!.resolveBrowserJourneyEnvironment(validEnvironment),
      {
        fetchImpl,
        runDatabaseMaintenance: async (payload) => {
          databaseMaintenance.push(payload);
        },
        runOpenSearchCleanup: async (request) => {
          openSearchCleanup.push(request);
        },
        randomUuid: uuid,
        now: () => new Date('2026-07-29T12:00:00.000Z'),
        sleep: async () => {},
      },
    );

    await service.setup();
    expect(service.state).toMatchObject({
      scopeId,
      workflowId,
      workflowName: expect.stringContaining('Browser release workflow'),
    });
    expect(service.state.seededRunIds).toHaveLength(51);
    expect(service.state.assetIds).toHaveLength(2);
    expect(databaseMaintenance[0]).toMatchObject({
      action: 'seed',
      organizationId: 'local-dev',
      workflowId,
      workflowVersionId,
      scopeId,
      runs: expect.arrayContaining([
        expect.objectContaining({ runId: service.state.seededRunIds[0] }),
      ]),
      assets: [
        expect.objectContaining({ assetType: 'subdomain' }),
        expect.objectContaining({ assetType: 'http-probe' }),
      ],
    });

    service.state.browserRunId = 'browser-run';
    const projection = await service.waitForRunAndProjections('browser-run');
    expect(projection.findingIds).toEqual([findingId]);
    service.state.findingIds.push(findingId);
    await service.cleanup();

    expect(openSearchCleanup).toHaveLength(1);
    expect(JSON.stringify(openSearchCleanup[0].body)).toContain(scopeId);
    expect(databaseMaintenance[1]).toEqual({
      action: 'cleanup',
      organizationId: 'local-dev',
      runIds: [...service.state.seededRunIds, 'browser-run'],
      assetIds: service.state.assetIds,
      findingIds: [findingId],
    });
    expect(requests.slice(-2)).toEqual([
      { method: 'DELETE', path: `/api/v1/workflows/${workflowId}` },
      { method: 'DELETE', path: `/api/v1/scopes/${scopeId}` },
    ]);
  });

  it('cleans the browser run scope even when finding projection discovery fails', async () => {
    const databaseMaintenance: FixtureMaintenancePayload[] = [];
    const openSearchCleanup: Array<{ index: string; body: unknown }> = [];
    const service = harness!.createBrowserFixtureService(
      harness!.resolveBrowserJourneyEnvironment(validEnvironment),
      {
        fetchImpl: (async (_input: string | URL | Request, init?: RequestInit) =>
          init?.method === 'POST'
            ? Response.json({}, { status: 200 })
            : new Response(null, { status: 204 })) as typeof fetch,
        runDatabaseMaintenance: async (payload) => {
          databaseMaintenance.push(payload);
        },
        runOpenSearchCleanup: async (request) => {
          openSearchCleanup.push(request);
        },
        randomUuid: () => '00000000-0000-4000-8000-000000000200',
        now: () => new Date('2026-07-29T12:00:00.000Z'),
        sleep: async () => {},
      },
    );
    service.state.scopeId = '00000000-0000-4000-8000-000000000201';
    service.state.browserRunId = 'browser-run-with-unavailable-projection';
    service.state.browserRunTerminal = true;

    await service.cleanup();

    expect(openSearchCleanup).toHaveLength(1);
    expect(JSON.stringify(openSearchCleanup[0].body)).toContain(service.state.scopeId);
    expect(databaseMaintenance).toEqual([
      {
        action: 'cleanup',
        organizationId: 'local-dev',
        runIds: ['browser-run-with-unavailable-projection'],
        assetIds: [],
        findingIds: [],
      },
    ]);
  });

  it('reconciles and cancels a scope-bound browser run when launch navigation loses its run ID', async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const cleanupEvents: string[] = [];
    const databaseMaintenance: FixtureMaintenancePayload[] = [];
    const openSearchCleanup: Array<{ index: string; body: unknown }> = [];
    const scopeId = '00000000-0000-4000-8000-000000000201';
    const workflowId = '00000000-0000-4000-8000-000000000202';
    const seededRunId = 'sentris-browser-history-existing';
    const discoveredRunId = 'sentris-browser-run-response-lost';
    let statusPoll = 0;
    const service = harness!.createBrowserFixtureService(
      harness!.resolveBrowserJourneyEnvironment(validEnvironment),
      {
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input));
          const method = init?.method ?? 'GET';
          requests.push({ method, path: `${url.pathname}${url.search}` });
          if (method === 'GET' && url.pathname.endsWith('/workflows/runs')) {
            return Response.json({
              runs: [
                { id: seededRunId, workflowId, status: 'COMPLETED' },
                { id: discoveredRunId, workflowId, status: 'RUNNING' },
              ],
            });
          }
          if (method === 'POST' && url.pathname.endsWith(`/${discoveredRunId}/cancel`)) {
            cleanupEvents.push('cancel');
            return Response.json({ status: 'CANCELLED' });
          }
          if (method === 'GET' && url.pathname.endsWith(`/${discoveredRunId}/status`)) {
            statusPoll += 1;
            const status = statusPoll === 1 ? 'RUNNING' : 'CANCELLED';
            cleanupEvents.push(`status:${status}`);
            return Response.json({ status });
          }
          if (method === 'DELETE') {
            cleanupEvents.push(`delete:${url.pathname}`);
            return new Response(null, { status: 204 });
          }
          return Response.json({ message: 'unexpected request' }, { status: 500 });
        }) as typeof fetch,
        runDatabaseMaintenance: async (payload) => {
          cleanupEvents.push('database');
          databaseMaintenance.push(payload);
        },
        runOpenSearchCleanup: async (request) => {
          cleanupEvents.push('opensearch');
          openSearchCleanup.push(request);
        },
        randomUuid: () => '00000000-0000-4000-8000-000000000200',
        now: () => new Date('2026-07-29T12:00:00.000Z'),
        sleep: async () => {},
      },
    );
    service.state.scopeId = scopeId;
    service.state.workflowId = workflowId;
    service.state.seededRunIds.push(seededRunId);
    service.state.launchAttempted = true;

    await service.cleanup();

    expect(requests).toContainEqual({
      method: 'GET',
      path: `/api/v1/workflows/runs?workflowId=${workflowId}&scopeId=${scopeId}&limit=200&offset=0`,
    });
    expect(requests).toContainEqual({
      method: 'POST',
      path: `/api/v1/workflows/runs/${discoveredRunId}/cancel`,
    });
    expect(
      requests.filter(
        (request) =>
          request.method === 'GET' &&
          request.path === `/api/v1/workflows/runs/${discoveredRunId}/status`,
      ),
    ).toHaveLength(2);
    expect(cleanupEvents.slice(0, 4)).toEqual([
      'cancel',
      'status:RUNNING',
      'status:CANCELLED',
      'opensearch',
    ]);
    expect(cleanupEvents.indexOf('database')).toBeGreaterThan(
      cleanupEvents.indexOf('status:CANCELLED'),
    );
    expect(openSearchCleanup).toHaveLength(1);
    expect(JSON.stringify(openSearchCleanup[0].body)).toContain(scopeId);
    expect(databaseMaintenance).toEqual([
      {
        action: 'cleanup',
        organizationId: 'local-dev',
        runIds: [seededRunId, discoveredRunId],
        assetIds: [],
        findingIds: [],
      },
    ]);
  });

  it('retains fixture data when a cancelled fallback run never reaches a terminal status', async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const databaseMaintenance: FixtureMaintenancePayload[] = [];
    const openSearchCleanup: Array<{ index: string; body: unknown }> = [];
    const scopeId = '00000000-0000-4000-8000-000000000211';
    const workflowId = '00000000-0000-4000-8000-000000000212';
    const discoveredRunId = 'sentris-browser-run-stuck';
    const service = harness!.createBrowserFixtureService(
      harness!.resolveBrowserJourneyEnvironment(validEnvironment),
      {
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input));
          const method = init?.method ?? 'GET';
          requests.push({ method, path: `${url.pathname}${url.search}` });
          if (method === 'GET' && url.pathname.endsWith('/workflows/runs')) {
            return Response.json({
              runs: [{ id: discoveredRunId, workflowId, status: 'RUNNING' }],
            });
          }
          if (method === 'POST' && url.pathname.endsWith(`/${discoveredRunId}/cancel`)) {
            return Response.json({ status: 'CANCEL_REQUESTED' });
          }
          if (method === 'GET' && url.pathname.endsWith(`/${discoveredRunId}/status`)) {
            return Response.json({ status: 'RUNNING' });
          }
          return Response.json({ message: 'unexpected request' }, { status: 500 });
        }) as typeof fetch,
        runDatabaseMaintenance: async (payload) => {
          databaseMaintenance.push(payload);
        },
        runOpenSearchCleanup: async (request) => {
          openSearchCleanup.push(request);
        },
        randomUuid: () => '00000000-0000-4000-8000-000000000210',
        now: () => new Date('2026-07-29T12:00:00.000Z'),
        sleep: async () => {},
      },
    );
    service.state.scopeId = scopeId;
    service.state.workflowId = workflowId;
    service.state.launchAttempted = true;

    await expect(service.cleanup()).rejects.toThrow('did not reach a terminal status');

    expect(openSearchCleanup).toHaveLength(0);
    expect(databaseMaintenance).toHaveLength(0);
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
  });

  it('retains fixture data when launch reconciliation cannot discover scope-bound runs', async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const databaseMaintenance: FixtureMaintenancePayload[] = [];
    const openSearchCleanup: Array<{ index: string; body: unknown }> = [];
    const scopeId = '00000000-0000-4000-8000-000000000221';
    const workflowId = '00000000-0000-4000-8000-000000000222';
    const service = harness!.createBrowserFixtureService(
      harness!.resolveBrowserJourneyEnvironment(validEnvironment),
      {
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input));
          const method = init?.method ?? 'GET';
          requests.push({ method, path: `${url.pathname}${url.search}` });
          if (method === 'GET' && url.pathname.endsWith('/workflows/runs')) {
            return Response.json({ message: 'run store unavailable' }, { status: 503 });
          }
          return Response.json({ message: 'unexpected request' }, { status: 500 });
        }) as typeof fetch,
        runDatabaseMaintenance: async (payload) => {
          databaseMaintenance.push(payload);
        },
        runOpenSearchCleanup: async (request) => {
          openSearchCleanup.push(request);
        },
        randomUuid: () => '00000000-0000-4000-8000-000000000220',
        now: () => new Date('2026-07-29T12:00:00.000Z'),
        sleep: async () => {},
      },
    );
    service.state.scopeId = scopeId;
    service.state.workflowId = workflowId;
    service.state.launchAttempted = true;

    await expect(service.cleanup()).rejects.toThrow('discover scope-bound browser runs');

    expect(openSearchCleanup).toHaveLength(0);
    expect(databaseMaintenance).toHaveLength(0);
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
  });

  it('executes every operator-visible checkpoint in order and records browser-created identities', async () => {
    const events: string[] = [];
    const state: FixtureState = {
      seededRunIds: Array.from({ length: 51 }, (_, index) => `seeded-run-${index}`),
      assetIds: ['asset-subdomain', 'asset-http'],
      findingIds: [],
    };
    const fixtureService = {
      state,
      async setup() {
        state.scopeId = '00000000-0000-4000-8000-000000000001';
        state.scopeName = 'Browser target fixture';
        state.workflowId = '00000000-0000-4000-8000-000000000002';
        state.workflowName = 'Browser workflow fixture';
        events.push('fixture:setup');
      },
      async waitForRunAndProjections(runId: string) {
        events.push(`fixture:wait:${runId}`);
        return { findingIds: ['finding-from-browser-run'] };
      },
      async cleanup() {
        events.push(
          `fixture:cleanup:${[...state.seededRunIds, state.browserRunId, ...state.findingIds]
            .filter(Boolean)
            .join(',')}`,
        );
      },
    };
    const driver = {
      async loginThroughLocalAdmin() {
        events.push('ui:login');
      },
      async openTargetFromList() {
        events.push('ui:target-detail');
      },
      async launchScopedZeroInputWorkflow() {
        events.push('ui:scoped-zero-input-run');
        return 'browser-run';
      },
      async proveRunHistoryPagination() {
        events.push('ui:history-pagination');
      },
      async openRunFromHistory() {
        events.push('ui:open-run');
      },
      async proveAssetTypeFilterAndSourceRun() {
        events.push('ui:asset-filter-source');
      },
      async proveScopeFindingDeepLinkAndTriage() {
        events.push('ui:finding-deep-link-triage');
        return 'finding-from-browser-run';
      },
      async proveRescanPreservesScope() {
        events.push('ui:rescan-scope');
      },
      async close() {
        events.push('browser:close');
      },
    };

    const result = await harness!.runBrowserTargetJourneyLifecycle({
      env: validEnvironment,
      fixtureService,
      createDriver: async () => driver,
    });

    expect(result.checkpoints).toEqual([
      'local-admin-login',
      'target-row-to-detail',
      'scoped-zero-input-run',
      'run-history-pagination',
      'open-run',
      'asset-filter-and-source-run',
      'scope-finding-deep-link-and-triage',
      'rescan-preserves-scope',
    ]);
    expect(events).toEqual([
      'fixture:setup',
      'ui:login',
      'ui:target-detail',
      'ui:scoped-zero-input-run',
      'fixture:wait:browser-run',
      'ui:history-pagination',
      'ui:open-run',
      'ui:asset-filter-source',
      'ui:finding-deep-link-triage',
      'ui:rescan-scope',
      'browser:close',
      expect.stringContaining('fixture:cleanup:seeded-run-0,seeded-run-1,seeded-run-2'),
    ]);
    expect(state.browserRunId).toBe('browser-run');
    expect(state.findingIds).toEqual(['finding-from-browser-run']);
  });

  it('closes the browser and cleans exact fixture identities after an interaction failure', async () => {
    const events: string[] = [];
    const state: FixtureState = {
      scopeId: '00000000-0000-4000-8000-000000000001',
      workflowId: '00000000-0000-4000-8000-000000000002',
      seededRunIds: ['seeded-1', 'seeded-2'],
      assetIds: ['asset-1'],
      browserRunId: 'browser-run-before-failure',
      findingIds: ['finding-before-failure'],
    };
    const fixtureService = {
      state,
      async setup() {
        events.push('fixture:setup');
      },
      async waitForRunAndProjections() {
        throw new Error('projection wait should not be reached');
      },
      async cleanup() {
        events.push(
          `cleanup:${state.seededRunIds.join(',')}:${state.browserRunId}:${state.findingIds.join(
            ',',
          )}`,
        );
      },
    };
    const driver = {
      async loginThroughLocalAdmin() {
        events.push('ui:login');
      },
      async openTargetFromList() {
        throw new Error('target row missing');
      },
      async launchScopedZeroInputWorkflow() {
        throw new Error('unreachable');
      },
      async proveRunHistoryPagination() {},
      async openRunFromHistory() {},
      async proveAssetTypeFilterAndSourceRun() {},
      async proveScopeFindingDeepLinkAndTriage() {
        return 'unreachable';
      },
      async proveRescanPreservesScope() {},
      async close() {
        events.push('browser:close');
      },
    };

    await expect(
      harness!.runBrowserTargetJourneyLifecycle({
        env: validEnvironment,
        fixtureService,
        createDriver: async () => driver,
      }),
    ).rejects.toThrow('target row missing');
    expect(events).toEqual([
      'fixture:setup',
      'ui:login',
      'browser:close',
      'cleanup:seeded-1,seeded-2:browser-run-before-failure:finding-before-failure',
    ]);
  });
});
