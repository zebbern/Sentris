#!/usr/bin/env node

const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..');
const composePrefix = ['compose', '-f', 'docker/docker-compose.full.yml'];

const JOURNEY_CHECKPOINTS = [
  'local-admin-login',
  'target-row-to-detail',
  'scoped-zero-input-run',
  'run-history-pagination',
  'open-run',
  'asset-filter-and-source-run',
  'scope-finding-deep-link-and-triage',
  'rescan-preserves-scope',
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;
const FINDING_ID_PATTERN = /^fo_v1_[a-f0-9]{64}$/;
const TERMINAL_RUN_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT',
]);

function required(input, name) {
  const value = input[name]?.trim();
  if (!value) throw new Error(`${name} must be set for the production browser journey`);
  return value;
}

function resolveBrowserJourneyEnvironment(input) {
  const instance = input.SENTRIS_INSTANCE?.trim();
  if (!instance) {
    throw new Error('SENTRIS_INSTANCE must be set explicitly for the production browser journey');
  }
  if (!/^\d+$/.test(instance)) {
    throw new Error('SENTRIS_INSTANCE must be a non-negative integer');
  }
  if (input.SENTRIS_TRUST_PROFILE?.trim() !== 'trusted-local') {
    throw new Error('The production browser journey requires SENTRIS_TRUST_PROFILE=trusted-local');
  }
  if (input.CI !== 'true' && input.SENTRIS_ALLOW_PRODUCTION_BROWSER_JOURNEY !== 'true') {
    throw new Error(
      'The production browser journey is destructive; run in CI or set SENTRIS_ALLOW_PRODUCTION_BROWSER_JOURNEY=true',
    );
  }

  const headless = input.SENTRIS_BROWSER_JOURNEY_HEADLESS?.trim() || 'true';
  if (headless !== 'true' && headless !== 'false') {
    throw new Error('SENTRIS_BROWSER_JOURNEY_HEADLESS must be true or false');
  }
  const baseUrl = input.SENTRIS_BROWSER_BASE_URL?.trim() || input.SENTRIS_SMOKE_NGINX_URL?.trim();
  if (!baseUrl) {
    throw new Error('SENTRIS_BROWSER_BASE_URL must be set for the production browser journey');
  }
  let normalizedBaseUrl;
  try {
    normalizedBaseUrl = new URL(baseUrl).toString().replace(/\/+$/, '');
  } catch {
    throw new Error('SENTRIS_BROWSER_BASE_URL must be an absolute URL');
  }

  return {
    ...input,
    SENTRIS_INSTANCE: instance,
    SENTRIS_TRUST_PROFILE: 'trusted-local',
    SENTRIS_BROWSER_BASE_URL: normalizedBaseUrl,
    SENTRIS_BROWSER_JOURNEY_HEADLESS: headless,
    ADMIN_USERNAME: required(input, 'ADMIN_USERNAME'),
    ADMIN_PASSWORD: required(input, 'ADMIN_PASSWORD'),
    INTERNAL_SERVICE_TOKEN: required(input, 'INTERNAL_SERVICE_TOKEN'),
    COMPOSE_PROJECT_NAME: required(input, 'COMPOSE_PROJECT_NAME'),
  };
}

function assertUuid(value, name) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be a UUID`);
}

function assertRunId(value, name = 'runId') {
  if (!RUN_ID_PATTERN.test(value)) {
    throw new Error(`${name} contains unsupported characters`);
  }
}

function assertOrganizationId(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 191 ||
    /[\u0000-\u001f\u007f'\\]/.test(value)
  ) {
    throw new Error('organizationId contains unsupported characters');
  }
}

function buildBrowserFixtureWorkflow(name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Browser fixture workflow name is required');
  }
  return {
    name: name.trim(),
    description: 'Disposable real-browser release fixture with no runtime inputs',
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Start',
          config: { params: { runtimeInputs: [] }, inputOverrides: {} },
        },
      },
      {
        id: 'fixture',
        type: 'test.analytics.fixture',
        position: { x: 260, y: 0 },
        data: {
          label: 'Deterministic finding fixture',
          config: { params: {}, inputOverrides: {} },
        },
      },
      {
        id: 'sink',
        type: 'core.analytics.sink',
        position: { x: 520, y: 0 },
        data: {
          label: 'Index deterministic findings',
          config: {
            params: {
              dataInputs: [{ id: 'results', label: 'Results', sourceTag: 'browser-fixture' }],
              assetKeyField: 'auto',
              failOnError: true,
            },
            inputOverrides: {},
          },
        },
      },
    ],
    edges: [
      { id: 'start-fixture', source: 'start', target: 'fixture' },
      { id: 'fixture-sink-control', source: 'fixture', target: 'sink' },
      {
        id: 'fixture-sink-results',
        source: 'fixture',
        target: 'sink',
        sourceHandle: 'results',
        targetHandle: 'results',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function buildOpenSearchFixtureCleanup(input) {
  assertOrganizationId(input.organizationId);
  assertUuid(input.scopeId, 'scopeId');
  const organizationKey = `o${createHash('sha256')
    .update(input.organizationId, 'utf8')
    .digest('hex')}`;
  return {
    index: `security-findings-${organizationKey}-observations-v1`,
    body: {
      query: {
        bool: {
          filter: [
            { term: { 'sentris.organization_id': input.organizationId } },
            { term: { 'sentris.scope_id': input.scopeId } },
          ],
        },
      },
    },
  };
}

async function readBrowserRunStartResponse(response) {
  if (!response.ok()) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Browser workflow start returned HTTP ${response.status()}${
        detail ? `: ${detail.slice(0, 500)}` : ''
      }`,
    );
  }
  const payload = await response.json().catch(() => null);
  const runId = payload?.runId;
  assertRunId(runId, 'browser runId');
  return runId;
}

function createBrowserFixtureService(env, dependencies) {
  const organizationId = 'local-dev';
  const apiBase = new URL('/api/v1/', env.SENTRIS_BROWSER_BASE_URL);
  const state = {
    seededRunIds: [],
    assetIds: [],
    findingIds: [],
    launchAttempted: false,
    browserRunTerminal: false,
  };
  const requestHeaders = {
    'Content-Type': 'application/json',
    'x-internal-token': env.INTERNAL_SERVICE_TOKEN,
    'x-organization-id': organizationId,
  };

  async function apiRequest(path, init = {}, expectedStatuses = [200]) {
    const response = await dependencies.fetchImpl(new URL(path.replace(/^\/+/, ''), apiBase), {
      ...init,
      headers: { ...requestHeaders, ...(init.headers ?? {}) },
    });
    if (!expectedStatuses.includes(response.status)) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `${init.method ?? 'GET'} ${path} returned HTTP ${response.status}${
          detail ? `: ${detail.slice(0, 500)}` : ''
        }`,
      );
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function setup() {
    const suffix = `${env.SENTRIS_INSTANCE}-${dependencies.randomUuid().slice(0, 8)}`;
    state.scopeName = `Browser release target ${suffix}`;
    state.workflowName = `Browser release workflow ${suffix}`;

    const scope = await apiRequest(
      'scopes',
      {
        method: 'POST',
        body: JSON.stringify({
          name: state.scopeName,
          description: 'Disposable trusted-local real-browser release target',
          domains: [`browser-${suffix}.example.com`],
          repos: [],
          ipRanges: [],
          runtimeValues: {},
        }),
      },
      [201],
    );
    assertUuid(scope?.id, 'created scope id');
    state.scopeId = scope.id;

    let workflow = await apiRequest(
      'workflows',
      {
        method: 'POST',
        body: JSON.stringify(buildBrowserFixtureWorkflow(state.workflowName)),
      },
      [201],
    );
    assertUuid(workflow?.id, 'created workflow id');
    state.workflowId = workflow.id;
    if (!workflow.currentVersionId || !workflow.currentVersion) {
      await apiRequest(`workflows/${encodeURIComponent(state.workflowId)}/commit`, {
        method: 'POST',
        body: '{}',
      });
      workflow = await apiRequest(`workflows/${encodeURIComponent(state.workflowId)}`);
    }
    assertUuid(workflow.currentVersionId, 'workflowVersionId');
    if (!Number.isInteger(workflow.currentVersion) || workflow.currentVersion < 1) {
      throw new Error('Created workflow did not expose a committed version');
    }
    state.workflowVersionId = workflow.currentVersionId;
    state.workflowVersion = workflow.currentVersion;

    const startTime = dependencies.now().getTime() - 60 * 60 * 1000;
    const runs = Array.from({ length: 51 }, (_, index) => {
      const runId = `sentris-browser-history-${dependencies.randomUuid()}`;
      state.seededRunIds.push(runId);
      return {
        runId,
        createdAt: new Date(startTime + index * 30_000).toISOString(),
      };
    });
    const subdomainAssetId = dependencies.randomUuid();
    const httpAssetId = dependencies.randomUuid();
    state.assetIds.push(subdomainAssetId, httpAssetId);

    await dependencies.runDatabaseMaintenance({
      action: 'seed',
      organizationId,
      workflowId: state.workflowId,
      workflowVersionId: state.workflowVersionId,
      workflowVersion: state.workflowVersion,
      scopeId: state.scopeId,
      runs,
      assets: [
        {
          id: subdomainAssetId,
          assetType: 'subdomain',
          assetValue: `browser-${suffix}.example.com`,
          sourceRunId: runs[50].runId,
        },
        {
          id: httpAssetId,
          assetType: 'http-probe',
          assetValue: `https://browser-${suffix}.example.com`,
          sourceRunId: runs[49].runId,
        },
      ],
    });
  }

  async function waitForRunAndProjections(runId) {
    assertRunId(runId);
    let lastStatus = 'UNKNOWN';
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const status = await apiRequest(`workflows/runs/${encodeURIComponent(runId)}/status`);
      lastStatus = status?.status ?? 'UNKNOWN';
      if (lastStatus === 'COMPLETED') {
        state.browserRunTerminal = true;
        break;
      }
      if (['FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT'].includes(lastStatus)) {
        state.browserRunTerminal = true;
        throw new Error(`Browser-started workflow ended with ${lastStatus}`);
      }
      await dependencies.sleep(1_000);
    }
    if (lastStatus !== 'COMPLETED') {
      throw new Error(`Browser-started workflow did not complete (last status ${lastStatus})`);
    }

    let lastAvailability = 'unknown';
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const findings = await apiRequest(
        `findings?scopeId=${encodeURIComponent(state.scopeId)}&pageSize=100`,
      );
      lastAvailability = findings?.availability ?? 'unknown';
      const ids = (findings?.items ?? [])
        .filter((item) => item?.run_id === runId && item?.scope_id === state.scopeId)
        .map((item) => item.id)
        .filter((id) => typeof id === 'string' && FINDING_ID_PATTERN.test(id));
      if (lastAvailability === 'available' && ids.length > 0) {
        return { findingIds: ids };
      }
      await dependencies.sleep(1_000);
    }
    throw new Error(
      `Browser-started finding projection was not visible (availability ${lastAvailability})`,
    );
  }

  async function waitForTerminalRun(runId) {
    let lastStatus = 'UNKNOWN';
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const status = await apiRequest(`workflows/runs/${encodeURIComponent(runId)}/status`);
      lastStatus = status?.status ?? 'UNKNOWN';
      if (TERMINAL_RUN_STATUSES.has(lastStatus)) return lastStatus;
      if (attempt < 59) await dependencies.sleep(1_000);
    }
    throw new Error(
      `Cancelled browser run ${runId} did not reach a terminal status (last status ${lastStatus})`,
    );
  }

  async function cleanup() {
    const cleanupErrors = [];
    const exactRunIds = [...state.seededRunIds];
    addUnique(exactRunIds, [state.browserRunId]);
    const discoveredRunStatuses = new Map();
    let terminalBarrierPassed = true;
    const attempt = async (label, operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    if (state.scopeId && state.workflowId && state.launchAttempted) {
      try {
        const query = new URLSearchParams({
          workflowId: state.workflowId,
          scopeId: state.scopeId,
          limit: '200',
          offset: '0',
        });
        const response = await apiRequest(`workflows/runs?${query.toString()}`);
        if (!Array.isArray(response?.runs)) {
          throw new Error('Scope-bound workflow run discovery returned an invalid response');
        }
        if (response.runs.length >= 200) {
          throw new Error('Scope-bound workflow run discovery exceeded the cleanup safety bound');
        }
        const seededRunIds = new Set(state.seededRunIds);
        for (const run of response.runs) {
          if (run?.workflowId !== state.workflowId) continue;
          assertRunId(run.id, 'discovered browser runId');
          if (seededRunIds.has(run.id)) continue;
          addUnique(exactRunIds, [run.id]);
          discoveredRunStatuses.set(run.id, run.status);
        }
      } catch (error) {
        terminalBarrierPassed = false;
        cleanupErrors.push(
          `discover scope-bound browser runs: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    for (const runId of exactRunIds.filter(
      (candidate) => !state.seededRunIds.includes(candidate),
    )) {
      const status = discoveredRunStatuses.get(runId);
      const isKnownTerminal =
        (runId === state.browserRunId && state.browserRunTerminal) ||
        (typeof status === 'string' && TERMINAL_RUN_STATUSES.has(status));
      if (isKnownTerminal) continue;
      try {
        await apiRequest(
          `workflows/runs/${encodeURIComponent(runId)}/cancel`,
          { method: 'POST', body: '{}' },
          [200, 201, 404, 409],
        );
        await waitForTerminalRun(runId);
      } catch (error) {
        terminalBarrierPassed = false;
        cleanupErrors.push(
          `cancel unfinished browser run ${runId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (!terminalBarrierPassed) {
      throw new Error(`Fixture cleanup failed:\n${cleanupErrors.join('\n')}`);
    }
    if (state.scopeId && (state.launchAttempted || state.browserRunId)) {
      await attempt('delete OpenSearch fixture observations', () =>
        dependencies.runOpenSearchCleanup(
          buildOpenSearchFixtureCleanup({ organizationId, scopeId: state.scopeId }),
        ),
      );
    }
    if (exactRunIds.length > 0 || state.assetIds.length > 0 || state.findingIds.length > 0) {
      await attempt('delete database fixture rows', () =>
        dependencies.runDatabaseMaintenance({
          action: 'cleanup',
          organizationId,
          runIds: exactRunIds,
          assetIds: state.assetIds,
          findingIds: state.findingIds,
        }),
      );
    }
    if (state.workflowId) {
      await attempt('delete fixture workflow', () =>
        apiRequest(
          `workflows/${encodeURIComponent(state.workflowId)}`,
          { method: 'DELETE' },
          [200, 204, 404],
        ),
      );
    }
    if (state.scopeId) {
      await attempt('delete fixture target', () =>
        apiRequest(
          `scopes/${encodeURIComponent(state.scopeId)}`,
          { method: 'DELETE' },
          [200, 204, 404],
        ),
      );
    }
    if (cleanupErrors.length > 0) {
      throw new Error(`Fixture cleanup failed:\n${cleanupErrors.join('\n')}`);
    }
  }

  return {
    state,
    setup,
    waitForRunAndProjections,
    cleanup,
  };
}

function runCommand(command, args, env, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    shell: false,
    stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    input: options.input,
    encoding: options.input === undefined ? undefined : 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.slice(0, 4).join(' ')} failed with exit code ${
        result.status ?? 'unknown'
      }`,
    );
  }
}

function buildDatabaseMaintenanceInvocation(env, payload) {
  if (payload?.action !== 'seed' && payload?.action !== 'cleanup') {
    throw new Error('Database fixture maintenance action must be seed or cleanup');
  }
  return {
    command: 'docker',
    args: [
      ...composePrefix,
      'exec',
      '-T',
      '-e',
      'BROWSER_TARGET_FIXTURE_DATABASE_URL',
      'backend',
      'bun',
      'scripts/browser-target-fixture-maintenance.ts',
      payload.action,
    ],
    env: {
      ...env,
      BROWSER_TARGET_FIXTURE_DATABASE_URL: 'postgresql://sentris:sentris@postgres:5432/sentris',
    },
    input: JSON.stringify(payload),
  };
}

function createMaintenanceDependencies(env) {
  return {
    fetchImpl: fetch,
    randomUuid: randomUUID,
    now: () => new Date(),
    sleep: (milliseconds) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
    async runDatabaseMaintenance(payload) {
      const invocation = buildDatabaseMaintenanceInvocation(env, payload);
      runCommand(invocation.command, invocation.args, invocation.env, { input: invocation.input });
    },
    async runOpenSearchCleanup(request) {
      runCommand(
        'docker',
        [
          ...composePrefix,
          'exec',
          '-T',
          'opensearch',
          'curl',
          '--fail-with-body',
          '--silent',
          '--show-error',
          '-X',
          'POST',
          `http://localhost:9200/${request.index}/_delete_by_query?refresh=true&conflicts=proceed`,
          '-H',
          'Content-Type: application/json',
          '--data-binary',
          JSON.stringify(request.body),
        ],
        env,
      );
    },
  };
}

async function pollUntil(description, operation, predicate, options = {}) {
  const attempts = options.attempts ?? 60;
  const intervalMs = options.intervalMs ?? 500;
  let lastValue;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastValue = await operation();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error(`${description} was not satisfied (last value ${JSON.stringify(lastValue)})`);
}

async function createPlaywrightJourneyDriver(env, state) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (error) {
    throw new Error(
      `Playwright is required for the production browser journey: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const browser = await playwright.chromium.launch({
    headless: env.SENTRIS_BROWSER_JOURNEY_HEADLESS === 'true',
  });
  const context = await browser.newContext({
    baseURL: env.SENTRIS_BROWSER_BASE_URL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(30_000);

  function requireFixtureIdentity(name) {
    const value = state[name];
    if (!value) throw new Error(`Fixture ${name} is unavailable`);
    return value;
  }

  async function waitForTargetDetail(tab) {
    const scopeId = requireFixtureIdentity('scopeId');
    await page.waitForURL((url) => {
      const suffix = tab && tab !== 'overview' ? `/${tab}` : '';
      return url.pathname === `/targets/${scopeId}${suffix}`;
    });
    await page.getByRole('heading', { name: state.scopeName, exact: true }).waitFor();
  }

  async function clickSidebarTargets() {
    const links = page.getByRole('link', { name: 'Targets', exact: true });
    const count = await links.count();
    for (let index = 0; index < count; index += 1) {
      if (await links.nth(index).isVisible()) {
        await links.nth(index).click();
        await page.waitForURL((url) => url.pathname === '/targets');
        return;
      }
    }
    throw new Error('Visible Targets navigation link was not found');
  }

  async function loginThroughLocalAdmin() {
    await page.goto('/?returnTo=%2Ftargets');
    await page.getByRole('heading', { name: 'Admin Login', exact: true }).waitFor();
    await page.getByLabel('Username', { exact: true }).fill(env.ADMIN_USERNAME);
    await page.getByLabel('Password', { exact: true }).fill(env.ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/targets');
    await page.getByRole('table', { name: 'Targets' }).waitFor();
  }

  async function openTargetFromList() {
    const scopeId = requireFixtureIdentity('scopeId');
    const link = page.getByRole('link', { name: state.scopeName, exact: true });
    await link.waitFor();
    await link.click();
    await page.waitForURL((url) => url.pathname === `/targets/${scopeId}`);
    await waitForTargetDetail('overview');
  }

  async function launchScopedZeroInputWorkflow() {
    const scopeId = requireFixtureIdentity('scopeId');
    const workflowId = requireFixtureIdentity('workflowId');
    await page.getByRole('link', { name: 'Run target', exact: true }).click();
    await page.waitForURL((url) => {
      return (
        url.pathname === '/workflows' &&
        url.searchParams.get('scopeId') === scopeId &&
        url.searchParams.get('launch') === '1'
      );
    });
    const workflowTable = page.getByRole('table', { name: 'Workflows' });
    await workflowTable.waitFor();
    const workflowRow = workflowTable
      .getByRole('row')
      .filter({ hasText: state.workflowName })
      .first();
    await workflowRow.waitFor();
    await workflowRow.click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'Run Workflow', exact: true }).waitFor();
    await dialog.getByText('Click Run to start the workflow execution.', { exact: true }).waitFor();
    const scopeTrigger = dialog.getByLabel('Run against target', { exact: true });
    await scopeTrigger.waitFor();
    if (!(await scopeTrigger.textContent())?.includes(state.scopeName)) {
      throw new Error('Scoped run dialog did not retain the selected target');
    }
    state.launchAttempted = true;
    const runStartPath = `/api/v1/workflows/${encodeURIComponent(workflowId)}/run`;
    const [runStartResponse] = await Promise.all([
      page.waitForResponse((response) => {
        return (
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === runStartPath
        );
      }),
      dialog.getByRole('button', { name: 'Run Workflow', exact: true }).click(),
    ]);
    const runId = await readBrowserRunStartResponse(runStartResponse);
    state.browserRunId = runId;
    await page.waitForURL(
      (url) => url.pathname === `/workflows/${workflowId}/runs/${encodeURIComponent(runId)}`,
    );
    return runId;
  }

  async function proveRunHistoryPagination() {
    await clickSidebarTargets();
    await page.getByRole('link', { name: state.scopeName, exact: true }).click();
    await waitForTargetDetail('overview');
    await page.getByRole('tab', { name: 'Run History', exact: true }).click();
    await waitForTargetDetail('runs');

    const rows = page.getByRole('table', { name: 'Run history' }).locator('tbody tr');
    const initialCount = await pollUntil(
      'initial 50-row target history page',
      () => rows.count(),
      (count) => count === 50,
    );
    if (initialCount !== 50) throw new Error(`Expected 50 initial runs, received ${initialCount}`);
    await page.getByRole('button', { name: 'Load more runs', exact: true }).click();
    const loadedCount = await pollUntil(
      'target history Load More page',
      () => rows.count(),
      (count) => count > 50,
    );
    if (loadedCount < 52) {
      throw new Error(`Expected at least 52 runs after Load More, received ${loadedCount}`);
    }
  }

  async function openRunFromHistory() {
    const sourceRunId = state.seededRunIds.at(-1);
    assertRunId(sourceRunId, 'source history runId');
    await page.getByRole('link', { name: `Open run ${sourceRunId}`, exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === `/workflows/${state.workflowId}/runs/${sourceRunId}`,
    );
    await page.goBack();
    await waitForTargetDetail('runs');
  }

  async function proveAssetTypeFilterAndSourceRun() {
    const sourceRunId = state.seededRunIds.at(-1);
    assertRunId(sourceRunId, 'asset source runId');
    await page.getByRole('tab', { name: 'Assets', exact: true }).click();
    await waitForTargetDetail('assets');
    const table = page.getByRole('table', { name: 'Assets' });
    await table.waitFor();
    await page.getByLabel('Filter assets by type', { exact: true }).selectOption('subdomain');
    const rows = table.locator('tbody tr');
    await pollUntil(
      'subdomain asset filter',
      () => rows.count(),
      (count) => count === 1,
    );
    const rowText = await rows.first().textContent();
    if (!rowText?.includes('subdomain') || rowText.includes('http-probe')) {
      throw new Error(`Asset type filter returned unexpected row: ${rowText ?? '<empty>'}`);
    }
    await table.getByRole('link', { name: `Open source run ${sourceRunId}`, exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === `/workflows/${state.workflowId}/runs/${sourceRunId}`,
    );
    await page.goBack();
    await waitForTargetDetail('assets');
  }

  async function proveScopeFindingDeepLinkAndTriage() {
    const scopeId = requireFixtureIdentity('scopeId');
    await page.getByRole('tab', { name: 'Findings', exact: true }).click();
    await waitForTargetDetail('findings');
    const findingLink = page
      .getByRole('table', { name: 'Target findings' })
      .getByRole('link', { name: 'Open finding Fixture Finding 1', exact: true });
    await findingLink.waitFor({ timeout: 60_000 });
    await findingLink.click();
    await page.waitForURL((url) => {
      return (
        url.pathname === '/findings' &&
        url.searchParams.get('scopeId') === scopeId &&
        Boolean(url.searchParams.get('findingId'))
      );
    });
    const findingId = new URL(page.url()).searchParams.get('findingId');
    if (!findingId || !FINDING_ID_PATTERN.test(findingId)) {
      throw new Error('Finding deep link did not expose a canonical finding ID');
    }

    const sheet = page.getByRole('dialog');
    await sheet.getByRole('heading', { name: 'Finding Details', exact: true }).waitFor();
    const detailText = await sheet.textContent();
    if (!detailText?.includes(state.browserRunId)) {
      throw new Error('Finding detail did not belong to the browser-started run');
    }
    await sheet.getByRole('combobox', { name: 'Change status', exact: true }).click();
    await page.getByRole('option', { name: 'Triaged', exact: true }).click();
    await page.getByText('Triage updated', { exact: true }).waitFor();
    await sheet.getByText('Triaged', { exact: true }).waitFor();
    await page.goBack();
    await waitForTargetDetail('findings');
    return findingId;
  }

  async function proveRescanPreservesScope() {
    const scopeId = requireFixtureIdentity('scopeId');
    const workflowId = requireFixtureIdentity('workflowId');
    await page.getByRole('tab', { name: 'Run History', exact: true }).click();
    await waitForTargetDetail('runs');
    await page
      .getByRole('link', { name: `Rescan with ${state.workflowName}`, exact: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'Run Workflow', exact: true }).waitFor();
    const current = new URL(page.url());
    if (
      current.pathname !== `/workflows/${workflowId}` ||
      current.searchParams.get('scopeId') !== scopeId
    ) {
      throw new Error(`Rescan did not preserve target scope: ${current.toString()}`);
    }
    const scopeTrigger = dialog.getByLabel('Run against target', { exact: true });
    if (!(await scopeTrigger.textContent())?.includes(state.scopeName)) {
      throw new Error('Rescan dialog did not retain the target');
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }

  return {
    loginThroughLocalAdmin,
    openTargetFromList,
    launchScopedZeroInputWorkflow,
    proveRunHistoryPagination,
    openRunFromHistory,
    proveAssetTypeFilterAndSourceRun,
    proveScopeFindingDeepLinkAndTriage,
    proveRescanPreservesScope,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

function addUnique(target, values) {
  for (const value of values) {
    if (value && !target.includes(value)) target.push(value);
  }
}

async function runBrowserTargetJourneyLifecycle({ env: input, fixtureService, createDriver }) {
  resolveBrowserJourneyEnvironment(input);
  const checkpoints = [];
  let driver;
  let primaryError;

  try {
    await fixtureService.setup();
    driver = await createDriver();

    await driver.loginThroughLocalAdmin();
    checkpoints.push(JOURNEY_CHECKPOINTS[0]);

    await driver.openTargetFromList();
    checkpoints.push(JOURNEY_CHECKPOINTS[1]);

    const browserRunId = await driver.launchScopedZeroInputWorkflow();
    fixtureService.state.browserRunId = browserRunId;
    checkpoints.push(JOURNEY_CHECKPOINTS[2]);

    const projection = await fixtureService.waitForRunAndProjections(browserRunId);
    addUnique(fixtureService.state.findingIds, projection.findingIds);

    await driver.proveRunHistoryPagination();
    checkpoints.push(JOURNEY_CHECKPOINTS[3]);

    await driver.openRunFromHistory();
    checkpoints.push(JOURNEY_CHECKPOINTS[4]);

    await driver.proveAssetTypeFilterAndSourceRun();
    checkpoints.push(JOURNEY_CHECKPOINTS[5]);

    const findingId = await driver.proveScopeFindingDeepLinkAndTriage();
    addUnique(fixtureService.state.findingIds, [findingId]);
    checkpoints.push(JOURNEY_CHECKPOINTS[6]);

    await driver.proveRescanPreservesScope();
    checkpoints.push(JOURNEY_CHECKPOINTS[7]);
  } catch (error) {
    primaryError = error;
  } finally {
    if (driver) {
      try {
        await driver.close();
      } catch (error) {
        primaryError ??= error;
      }
    }
    try {
      await fixtureService.cleanup();
    } catch (error) {
      if (!primaryError) primaryError = error;
      else {
        console.error(
          `[browser-target-journey] cleanup also failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  if (primaryError) throw primaryError;
  return { checkpoints };
}

async function runBrowserTargetJourney(input = process.env) {
  const env = resolveBrowserJourneyEnvironment(input);
  const fixtureService = createBrowserFixtureService(env, createMaintenanceDependencies(env));
  const result = await runBrowserTargetJourneyLifecycle({
    env,
    fixtureService,
    createDriver: () => createPlaywrightJourneyDriver(env, fixtureService.state),
  });
  console.log(`[browser-target-journey] passed checkpoints: ${result.checkpoints.join(', ')}`);
  return result;
}

if (require.main === module) {
  runBrowserTargetJourney().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  JOURNEY_CHECKPOINTS,
  buildBrowserFixtureWorkflow,
  buildDatabaseMaintenanceInvocation,
  buildOpenSearchFixtureCleanup,
  createBrowserFixtureService,
  createPlaywrightJourneyDriver,
  readBrowserRunStartResponse,
  resolveBrowserJourneyEnvironment,
  runBrowserTargetJourney,
  runBrowserTargetJourneyLifecycle,
};
