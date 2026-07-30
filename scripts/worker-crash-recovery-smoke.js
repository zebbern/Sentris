#!/usr/bin/env node

const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { basename, resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..');
const composePrefix = ['compose', '-f', 'docker/docker-compose.full.yml'];
const exchangeMetadataRoot = '/sentris-docker-io/metadata';
const exchangeRunsRoot = '/sentris-docker-io/runs';
const terminalStatuses = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'CONTINUED_AS_NEW',
  'TIMED_OUT',
]);
const safeDockerIdentifier = /^[a-zA-Z0-9_.-]+$/;
const safeRunLabel = /^[^\0\r\n]{1,256}$/;
const safeMetadataPath = /^\/sentris-docker-io\/metadata\/[a-zA-Z0-9_.-]+\.json$/;
const safeRunDirectoryPath = /^\/sentris-docker-io\/runs\/[a-zA-Z0-9_.-]+$/;

function parsePositiveInteger(value, name, fallback) {
  const raw = value?.trim() || fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function resolveCrashRecoveryEnvironment(input) {
  const instance = input.SENTRIS_INSTANCE?.trim();
  if (!instance) {
    throw new Error('SENTRIS_INSTANCE must be set explicitly for the worker crash/recovery smoke');
  }
  if (!/^\d+$/.test(instance)) {
    throw new Error('SENTRIS_INSTANCE must be a non-negative integer');
  }
  if (
    input.CI !== 'true' &&
    input.SENTRIS_ALLOW_WORKER_CRASH_RECOVERY_SMOKE !== 'true' &&
    input.SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE !== 'true'
  ) {
    throw new Error(
      'Worker crash/recovery smoke is destructive; run in CI or set SENTRIS_ALLOW_WORKER_CRASH_RECOVERY_SMOKE=true',
    );
  }

  const composeProject = input.COMPOSE_PROJECT_NAME?.trim();
  if (!composeProject) {
    throw new Error('COMPOSE_PROJECT_NAME must name the disposable production Compose project');
  }
  const internalServiceToken =
    input.E2E_INTERNAL_SERVICE_TOKEN?.trim() || input.INTERNAL_SERVICE_TOKEN?.trim();
  if (!internalServiceToken) {
    throw new Error(
      'E2E_INTERNAL_SERVICE_TOKEN or INTERNAL_SERVICE_TOKEN must be set for the internal E2E identity',
    );
  }

  const explicitApiBase = input.E2E_API_BASE_URL?.trim();
  const publicBase =
    input.SENTRIS_SMOKE_NGINX_URL?.trim() || input.SENTRIS_PUBLIC_API_BASE_URL?.trim();
  if (!explicitApiBase && !publicBase) {
    throw new Error(
      'E2E_API_BASE_URL or SENTRIS_SMOKE_NGINX_URL must target the disposable production stack',
    );
  }
  const apiBaseUrl = explicitApiBase ? new URL(explicitApiBase) : new URL('/api/v1', publicBase);
  if (apiBaseUrl.protocol !== 'http:' && apiBaseUrl.protocol !== 'https:') {
    throw new Error('Worker crash/recovery API base URL must use HTTP or HTTPS');
  }

  const waitSeconds = parsePositiveInteger(
    input.SENTRIS_WORKER_CRASH_WAIT_SECONDS,
    'SENTRIS_WORKER_CRASH_WAIT_SECONDS',
    '120',
  );
  const pollIntervalMs = parsePositiveInteger(
    input.SENTRIS_WORKER_CRASH_POLL_INTERVAL_MS,
    'SENTRIS_WORKER_CRASH_POLL_INTERVAL_MS',
    '1000',
  );

  return {
    ...input,
    SENTRIS_INSTANCE: instance,
    SENTRIS_DEPLOYMENT_ID: input.SENTRIS_DEPLOYMENT_ID?.trim() || 'sentris',
    COMPOSE_PROJECT_NAME: composeProject,
    E2E_INTERNAL_SERVICE_TOKEN: internalServiceToken,
    E2E_API_BASE_URL: apiBaseUrl.toString().replace(/\/+$/, ''),
    SENTRIS_WORKER_CRASH_WAIT_SECONDS: String(waitSeconds),
    SENTRIS_WORKER_CRASH_POLL_INTERVAL_MS: String(pollIntervalMs),
  };
}

function defaultExecFile(command, args, options) {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.message = `${command} ${args.join(' ')} failed: ${error.message}`;
          rejectCommand(error);
          return;
        }
        resolveCommand({ stdout, stderr });
      },
    );
  });
}

function resolveDependencies(dependencies = {}) {
  return {
    execFile: dependencies.execFile || defaultExecFile,
    fetch: dependencies.fetch || globalThis.fetch,
    sleep:
      dependencies.sleep ||
      ((milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))),
    log: dependencies.log || ((message) => console.log(message)),
    error: dependencies.error || ((message) => console.error(message)),
  };
}

function buildCrashRecoveryWorkflow(instance) {
  return {
    name: `worker-crash-recovery-${instance}-${randomBytes(6).toString('hex')}`,
    description: 'Production worker hard-crash and orphan reconciliation proof',
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Start',
          config: {
            params: { runtimeInputs: [] },
            inputOverrides: {},
          },
        },
      },
      {
        id: 'crash-probe',
        type: 'sentris.security.terminal-demo',
        position: { x: 260, y: 0 },
        data: {
          label: 'Worker crash recovery probe',
          config: {
            params: {
              durationSeconds: 300,
              message: 'Sentris production worker crash/recovery probe',
            },
            inputOverrides: {},
          },
        },
      },
    ],
    edges: [
      {
        id: 'start-crash-probe',
        source: 'start',
        target: 'crash-probe',
      },
    ],
  };
}

async function runComposeCommand(env, dependencies, args) {
  return dependencies.execFile('docker', [...composePrefix, ...args], {
    cwd: repoRoot,
    env,
    shell: false,
  });
}

async function requestJson(env, dependencies, path, options = {}) {
  const response = await dependencies.fetch(`${env.E2E_API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': env.E2E_INTERNAL_SERVICE_TOKEN,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let body = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        `${options.method || 'GET'} ${path} returned invalid JSON (HTTP ${response.status})`,
      );
    }
  }
  if (!response.ok) {
    throw new Error(
      `${options.method || 'GET'} ${path} returned HTTP ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  return body;
}

function labelFilters(env, runId) {
  return Object.entries(expectedRunLabels(env, runId)).flatMap(([key, value]) => [
    '--filter',
    `label=${key}=${value}`,
  ]);
}

function expectedRunLabels(env, runId) {
  return {
    'sentris.managed': 'true',
    'sentris.runId': runId,
    'sentris.deploymentId': env.SENTRIS_DEPLOYMENT_ID,
    'sentris.instance': env.SENTRIS_INSTANCE,
    'sentris.temporalNamespace': 'sentris-prod',
    'sentris.temporalTaskQueue': 'sentris-prod',
  };
}

function outputLines(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function requireIdentifiers(values, description) {
  for (const value of values) {
    if (typeof value !== 'string' || !safeDockerIdentifier.test(value)) {
      throw new Error(`${description} returned an unsafe identifier`);
    }
  }
  return values;
}

async function inspectContainerExchangeIds(env, dependencies, runId, containers) {
  if (containers.length === 0) return [];
  const { stdout } = await runComposeCommand(env, dependencies, [
    'exec',
    '-T',
    'dind',
    'docker',
    'inspect',
    ...containers,
  ]);
  let inspected;
  try {
    inspected = JSON.parse(stdout);
  } catch {
    throw new Error('Managed container inspection returned invalid JSON');
  }
  if (!Array.isArray(inspected)) {
    throw new Error('Managed container inspection returned a non-array response');
  }

  const expectedLabels = expectedRunLabels(env, runId);
  const listedContainers = new Set(containers);
  const inspectedContainers = new Set();
  const exchangeIds = [];
  for (const record of inspected) {
    const containerId = requireIdentifiers([record?.Id], 'Managed container inspection')[0];
    if (!listedContainers.has(containerId) || inspectedContainers.has(containerId)) {
      throw new Error('Managed container inspection returned an unexpected identifier');
    }
    inspectedContainers.add(containerId);

    const labels = record?.Config?.Labels;
    if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
      throw new Error(`Managed container ${containerId} inspection is missing labels`);
    }
    for (const [key, value] of Object.entries(expectedLabels)) {
      if (labels[key] !== value) {
        throw new Error(`Managed container ${containerId} does not match the exact run scope`);
      }
    }

    const exchangeId = labels['sentris.ioResource'];
    if (exchangeId !== undefined) {
      exchangeIds.push(
        requireIdentifiers([exchangeId], `Managed container ${containerId} exchange label`)[0],
      );
    }
  }
  if (inspectedContainers.size !== listedContainers.size) {
    throw new Error('Managed container inspection omitted a listed container');
  }
  return [...new Set(exchangeIds)].sort();
}

async function listRunResources(env, dependencies, runId, trackedExchangeIds = [], options = {}) {
  if (!safeRunLabel.test(runId)) {
    throw new Error('Workflow run ID is unsafe for an exact Docker label filter');
  }
  const filters = labelFilters(env, runId);
  const containers = requireIdentifiers(
    outputLines(
      (
        await runComposeCommand(env, dependencies, [
          'exec',
          '-T',
          'dind',
          'docker',
          'ps',
          '-aq',
          '--no-trunc',
          ...filters,
        ])
      ).stdout,
    ),
    'Managed container inventory',
  );
  const containerExchangeIds =
    options.inspectContainerExchangeIds === false
      ? []
      : await inspectContainerExchangeIds(env, dependencies, runId, containers);
  const volumes = requireIdentifiers(
    outputLines(
      (
        await runComposeCommand(env, dependencies, [
          'exec',
          '-T',
          'dind',
          'docker',
          'volume',
          'ls',
          '-q',
          ...filters,
        ])
      ).stdout,
    ),
    'Managed volume inventory',
  );
  const metadataPaths = outputLines(
    (
      await runComposeCommand(env, dependencies, [
        'exec',
        '-T',
        'dind',
        'find',
        exchangeMetadataRoot,
        '-mindepth',
        '1',
        '-maxdepth',
        '1',
        '-type',
        'f',
        '-name',
        '*.json',
        '-print',
      ])
    ).stdout,
  );
  const runDirectoryPaths = outputLines(
    (
      await runComposeCommand(env, dependencies, [
        'exec',
        '-T',
        'dind',
        'find',
        exchangeRunsRoot,
        '-mindepth',
        '1',
        '-maxdepth',
        '1',
        '-type',
        'd',
        '-print',
      ])
    ).stdout,
  );
  for (const metadataPath of metadataPaths) {
    if (!safeMetadataPath.test(metadataPath)) {
      throw new Error('Exchange metadata inventory returned an unsafe path');
    }
  }
  for (const runDirectoryPath of runDirectoryPaths) {
    if (!safeRunDirectoryPath.test(runDirectoryPath)) {
      throw new Error('Exchange directory inventory returned an unsafe path');
    }
  }

  const exchangeMetadata = [];
  for (const metadataPath of metadataPaths) {
    const raw = (
      await runComposeCommand(env, dependencies, ['exec', '-T', 'dind', 'cat', metadataPath])
    ).stdout;
    let metadata;
    try {
      metadata = JSON.parse(raw);
    } catch {
      throw new Error(`Exchange metadata ${metadataPath} is invalid JSON`);
    }
    const resourceId = basename(metadataPath, '.json');
    if (
      metadata?.managed === true &&
      metadata.resourceId === resourceId &&
      metadata.runId === runId &&
      metadata.deploymentId === env.SENTRIS_DEPLOYMENT_ID &&
      metadata.instanceId === env.SENTRIS_INSTANCE &&
      metadata.temporalNamespace === 'sentris-prod' &&
      metadata.temporalTaskQueue === 'sentris-prod'
    ) {
      exchangeMetadata.push(resourceId);
    }
  }

  const safeTrackedExchangeIds = requireIdentifiers(
    trackedExchangeIds,
    'Tracked exchange directory inventory',
  );
  const ownedExchangeIds = new Set([
    ...exchangeMetadata,
    ...containerExchangeIds,
    ...safeTrackedExchangeIds,
  ]);
  const exchangeDirectories = requireIdentifiers(
    runDirectoryPaths.map((path) => basename(path)),
    'Exchange directory inventory',
  ).filter((resourceId) => ownedExchangeIds.has(resourceId));

  return {
    containers: [...new Set(containers)].sort(),
    volumes: [...new Set(volumes)].sort(),
    containerExchangeIds,
    exchangeMetadata: [...new Set(exchangeMetadata)].sort(),
    exchangeDirectories: [...new Set(exchangeDirectories)].sort(),
  };
}

function hasStartedDockerResources(resources) {
  return (
    resources.containers.length > 0 &&
    resources.containerExchangeIds.some(
      (resourceId) =>
        resources.exchangeMetadata.includes(resourceId) &&
        resources.exchangeDirectories.includes(resourceId),
    )
  );
}

function inventoryDescription(resources) {
  return JSON.stringify({
    containers: resources.containers,
    volumes: resources.volumes,
    containerExchangeIds: resources.containerExchangeIds,
    exchangeMetadata: resources.exchangeMetadata,
    exchangeDirectories: resources.exchangeDirectories,
  });
}

function isEmptyInventory(resources) {
  return (
    resources.containers.length === 0 &&
    resources.volumes.length === 0 &&
    resources.containerExchangeIds.length === 0 &&
    resources.exchangeMetadata.length === 0 &&
    resources.exchangeDirectories.length === 0
  );
}

function missingPreservedResources(initial, current) {
  const missing = {};
  for (const key of [
    'containers',
    'volumes',
    'containerExchangeIds',
    'exchangeMetadata',
    'exchangeDirectories',
  ]) {
    const absent = initial[key].filter((id) => !current[key].includes(id));
    if (absent.length > 0) missing[key] = absent;
  }
  return missing;
}

function trackExchangeIds(trackedExchangeIds, resources) {
  for (const key of ['containerExchangeIds', 'exchangeMetadata', 'exchangeDirectories']) {
    for (const resourceId of resources[key]) trackedExchangeIds.add(resourceId);
  }
}

function hasReplacementAttemptResources(initial, current) {
  const initialContainers = new Set(initial.containers);
  const initialExchangeIds = new Set(initial.containerExchangeIds);
  return (
    current.containers.some((containerId) => !initialContainers.has(containerId)) &&
    current.containerExchangeIds.some(
      (resourceId) =>
        !initialExchangeIds.has(resourceId) && current.exchangeDirectories.includes(resourceId),
    )
  );
}

async function pollUntil(env, dependencies, operation, predicate) {
  const timeoutMs = Number.parseInt(env.SENTRIS_WORKER_CRASH_WAIT_SECONDS, 10) * 1000;
  const intervalMs = Number.parseInt(env.SENTRIS_WORKER_CRASH_POLL_INTERVAL_MS, 10);
  const attempts = Math.ceil(timeoutMs / intervalMs) + 1;
  let value;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    value = await operation();
    if (predicate(value)) return value;
    if (attempt + 1 < attempts) await dependencies.sleep(intervalMs);
  }
  return value;
}

async function verifyReconciliationConfiguration(env, dependencies) {
  const { stdout } = await runComposeCommand(env, dependencies, [
    'exec',
    '-T',
    'worker',
    'printenv',
    'WORKER_ORPHAN_MIN_AGE_MS',
    'WORKER_ORPHAN_INTERVAL_MS',
  ]);
  const values = outputLines(stdout);
  if (values[0] !== '0') {
    throw new Error(
      'Worker crash/recovery smoke requires WORKER_ORPHAN_MIN_AGE_MS=0 in the running worker',
    );
  }
  const intervalMs = Number.parseInt(values[1] || '', 10);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 5_000) {
    throw new Error(
      'Worker crash/recovery smoke requires WORKER_ORPHAN_INTERVAL_MS between 1 and 5000 in the running worker',
    );
  }
}

async function restartWorker(env, dependencies) {
  await runComposeCommand(env, dependencies, [
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    env.SENTRIS_WORKER_CRASH_WAIT_SECONDS,
    'worker',
  ]);
}

async function runWorkerCrashRecoverySmoke(input = process.env, injected = {}) {
  const env = resolveCrashRecoveryEnvironment(input);
  const dependencies = resolveDependencies(injected);
  let workflowId;
  let runId;
  let workerKilled = false;
  let workerRestarted = false;
  let cancellationRequested = false;
  let workflowDeleted = false;
  let primaryError;

  try {
    dependencies.log('[worker-crash-recovery-smoke] verifying reconciliation configuration');
    await verifyReconciliationConfiguration(env, dependencies);

    const workflow = await requestJson(env, dependencies, '/workflows', {
      method: 'POST',
      body: buildCrashRecoveryWorkflow(env.SENTRIS_INSTANCE),
    });
    if (typeof workflow.id !== 'string' || !workflow.id.trim()) {
      throw new Error('Workflow creation did not return an ID');
    }
    workflowId = workflow.id;

    const run = await requestJson(
      env,
      dependencies,
      `/workflows/${encodeURIComponent(workflowId)}/run`,
      { method: 'POST', body: { inputs: {} } },
    );
    if (typeof run.runId !== 'string' || !safeRunLabel.test(run.runId)) {
      throw new Error('Workflow start did not return a safe run ID');
    }
    runId = run.runId;

    const initialResources = await pollUntil(
      env,
      dependencies,
      () => listRunResources(env, dependencies, runId),
      hasStartedDockerResources,
    );
    if (!initialResources || !hasStartedDockerResources(initialResources)) {
      throw new Error(
        `Long-running Docker resources did not appear before the crash: ${inventoryDescription(
          initialResources || {
            containers: [],
            volumes: [],
            exchangeMetadata: [],
            exchangeDirectories: [],
          },
        )}`,
      );
    }

    dependencies.log('[worker-crash-recovery-smoke] hard-killing the production worker');
    await runComposeCommand(env, dependencies, ['kill', '-s', 'SIGKILL', 'worker']);
    workerKilled = true;

    const trackedExchangeIds = new Set();
    trackExchangeIds(trackedExchangeIds, initialResources);
    const resourcesWhileWorkerStopped = await listRunResources(env, dependencies, runId, [
      ...trackedExchangeIds,
    ]);
    trackExchangeIds(trackedExchangeIds, resourcesWhileWorkerStopped);
    const missingWhileStopped = missingPreservedResources(
      initialResources,
      resourcesWhileWorkerStopped,
    );
    if (Object.keys(missingWhileStopped).length > 0) {
      throw new Error(
        `Active run resources disappeared immediately after the worker hard-kill: ${JSON.stringify(
          missingWhileStopped,
        )}`,
      );
    }

    dependencies.log('[worker-crash-recovery-smoke] restarting the worker and awaiting readiness');
    await restartWorker(env, dependencies);
    workerRestarted = true;

    const activeStatus = await requestJson(
      env,
      dependencies,
      `/workflows/runs/${encodeURIComponent(runId)}/status`,
    );
    if (typeof activeStatus.status !== 'string' || terminalStatuses.has(activeStatus.status)) {
      throw new Error(
        `Crash probe run terminalized before active-resource preservation could be proven: ${
          activeStatus.status || 'UNKNOWN'
        }`,
      );
    }

    const restartedResources = await pollUntil(
      env,
      dependencies,
      async () => {
        const resources = await listRunResources(env, dependencies, runId, [...trackedExchangeIds]);
        trackExchangeIds(trackedExchangeIds, resources);
        return resources;
      },
      (resources) => hasReplacementAttemptResources(initialResources, resources),
    );
    if (
      !restartedResources ||
      !hasReplacementAttemptResources(initialResources, restartedResources)
    ) {
      throw new Error(
        'Replacement worker did not create a retry attempt for the active crash probe',
      );
    }
    const missingAfterRestart = missingPreservedResources(initialResources, restartedResources);
    if (Object.keys(missingAfterRestart).length > 0) {
      throw new Error(
        `Active run resources disappeared during worker startup reconciliation: ${JSON.stringify(
          missingAfterRestart,
        )}`,
      );
    }

    await requestJson(env, dependencies, `/workflows/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
    });
    cancellationRequested = true;

    const terminalStatus = await pollUntil(
      env,
      dependencies,
      () => requestJson(env, dependencies, `/workflows/runs/${encodeURIComponent(runId)}/status`),
      (status) => typeof status.status === 'string' && terminalStatuses.has(status.status),
    );
    if (
      !terminalStatus ||
      typeof terminalStatus.status !== 'string' ||
      !terminalStatuses.has(terminalStatus.status)
    ) {
      throw new Error('Crash probe run did not terminalize after cancellation');
    }

    const remainingResources = await pollUntil(
      env,
      dependencies,
      async () => {
        const resources = await listRunResources(
          env,
          dependencies,
          runId,
          [...trackedExchangeIds],
          // Containers can be removed between `docker ps` and `docker inspect`
          // once cancellation starts. Every attempt workspace was captured
          // while active, so terminal cleanup only needs exact label inventory
          // plus the retained exchange IDs.
          { inspectContainerExchangeIds: false },
        );
        trackExchangeIds(trackedExchangeIds, resources);
        return resources;
      },
      isEmptyInventory,
    );
    if (!remainingResources || !isEmptyInventory(remainingResources)) {
      throw new Error(
        `Run-scoped resources remained after terminalization: ${inventoryDescription(
          remainingResources,
        )}`,
      );
    }

    await requestJson(env, dependencies, `/workflows/${encodeURIComponent(workflowId)}`, {
      method: 'DELETE',
    });
    workflowDeleted = true;
    dependencies.log('[worker-crash-recovery-smoke] worker crash/reconciliation proof passed');
  } catch (error) {
    primaryError = error;
  } finally {
    if (workerKilled && !workerRestarted) {
      try {
        await restartWorker(env, dependencies);
        workerRestarted = true;
      } catch (error) {
        dependencies.error(
          `[worker-crash-recovery-smoke] worker recovery cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (runId && !cancellationRequested) {
      try {
        await requestJson(
          env,
          dependencies,
          `/workflows/runs/${encodeURIComponent(runId)}/cancel`,
          { method: 'POST' },
        );
        cancellationRequested = true;
      } catch (error) {
        dependencies.error(
          `[worker-crash-recovery-smoke] run cancellation cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (workflowId && !workflowDeleted) {
      try {
        await requestJson(env, dependencies, `/workflows/${encodeURIComponent(workflowId)}`, {
          method: 'DELETE',
        });
        workflowDeleted = true;
      } catch (error) {
        dependencies.error(
          `[worker-crash-recovery-smoke] workflow cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  if (primaryError) throw primaryError;
}

if (require.main === module) {
  runWorkerCrashRecoverySmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  buildCrashRecoveryWorkflow,
  listRunResources,
  resolveCrashRecoveryEnvironment,
  runWorkerCrashRecoverySmoke,
};
