#!/usr/bin/env node

const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..');
const composePrefix = ['compose', '-f', 'docker/docker-compose.full.yml'];
const SECOND_MS = 1_000;
const DEFAULT_STEP_TIMEOUT_MS = 60 * SECOND_MS;
const LIFECYCLE_HARNESS_TIMEOUT_MS = 600 * SECOND_MS;
const LIFECYCLE_MIGRATION_TIMEOUT_MS = 240 * SECOND_MS;
const LIFECYCLE_DATABASE_COMMAND_TIMEOUT_MS = 45 * SECOND_MS;
const FINDINGS_OPENSEARCH_HARNESS_TIMEOUT_MS = 1_500 * SECOND_MS;
const NGINX_PROBE_TIMEOUT_MS = 10 * SECOND_MS;
const OPENSEARCH_INIT_TIMEOUT_MS = 120 * SECOND_MS;
const PROCESS_TERMINATION_GRACE_MS = 5 * SECOND_MS;
const PROCESS_KILL_SETTLEMENT_MS = 3 * SECOND_MS;
const CLEANUP_UNSAFE_EXIT_CODE = 86;
const TELEMETRY_DURABILITY_COMPOSE_TIMEOUT_MS = 1_920 * SECOND_MS;
const LIFECYCLE_PGOPTIONS =
  '-c statement_timeout=120000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=30000';

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

function lifecycleDatabaseName(instance) {
  return `sentris_lifecycle_smoke_i${instance}`;
}

function resolveSmokeEnvironment(input) {
  const instance = input.SENTRIS_INSTANCE?.trim();
  if (!instance) {
    throw new Error('SENTRIS_INSTANCE must be set explicitly for the production Compose smoke');
  }
  if (!/^\d$/.test(instance)) {
    throw new Error('SENTRIS_INSTANCE must be an integer from 0 to 9');
  }

  const nginxUrl =
    input.SENTRIS_SMOKE_NGINX_URL?.trim() ||
    input.SENTRIS_PUBLIC_API_BASE_URL?.trim() ||
    'http://127.0.0.1';
  const internalServiceToken =
    input.E2E_INTERNAL_SERVICE_TOKEN?.trim() ||
    input.INTERNAL_SERVICE_TOKEN?.trim() ||
    randomToken();
  const e2eApiBaseUrl = new URL('/api/v1', nginxUrl).toString().replace(/\/+$/, '');
  const trustProfile = input.SENTRIS_TRUST_PROFILE?.trim() || 'trusted-local';
  if (trustProfile !== 'trusted-local' && trustProfile !== 'hardened') {
    throw new Error('SENTRIS_TRUST_PROFILE must be trusted-local or hardened');
  }
  const composeProjectName = `sentris-production-smoke-${instance}`;
  if (trustProfile === 'trusted-local' && input.SENTRIS_PRODUCTION_SMOKE_KEEP === 'true') {
    throw new Error(
      'SENTRIS_PRODUCTION_SMOKE_KEEP=true is incompatible with the destructive trusted-local telemetry durability smoke',
    );
  }
  const hardened = trustProfile === 'hardened';
  const clerkPublishableKey =
    input.CLERK_PUBLISHABLE_KEY?.trim() || 'pk_test_c2VudHJpcy1yZWxlYXNlLXNtb2tl';
  const clerkSecretKey = input.CLERK_SECRET_KEY?.trim() || 'sk_test_c2VudHJpcy1yZWxlYXNlLXNtb2tl';
  const lifecycleDurabilityApproved =
    input.CI === 'true' ||
    input.SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE === 'true' ||
    input.SENTRIS_ALLOW_LIFECYCLE_DURABILITY_SMOKE === 'true';
  const findingsOpenSearchApproved =
    input.CI === 'true' ||
    input.SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE === 'true' ||
    input.SENTRIS_ALLOW_FINDINGS_OPENSEARCH_SMOKE === 'true';
  const browserJourneyApproved =
    !hardened &&
    (input.CI === 'true' ||
      input.SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE === 'true' ||
      input.SENTRIS_ALLOW_PRODUCTION_BROWSER_JOURNEY === 'true');
  const lifecycleDatabase = lifecycleDatabaseName(instance);
  const lifecycleDatabaseUrl = `postgresql://sentris:sentris@postgres:5432/${lifecycleDatabase}`;
  const findingsOpenSearchDatabaseUrl = 'postgresql://sentris:sentris@postgres:5432/sentris';
  const findingsOpenSearchApiBaseUrl = 'http://localhost:3211/api/v1';
  const findingsOpenSearchUrl = 'http://opensearch:9200';
  const findingsOpenSearchPitHoldMs = '125000';
  for (const [name, expected] of [
    ['LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME', lifecycleDatabase],
    ['LIFECYCLE_DURABILITY_SMOKE_DATABASE_URL', lifecycleDatabaseUrl],
    ['DRIZZLE_DATABASE_URL', lifecycleDatabaseUrl],
  ]) {
    const supplied = input[name]?.trim();
    if (supplied && supplied !== expected) {
      throw new Error(
        `The production Compose smoke owns lifecycle database ${lifecycleDatabase}; ${name} cannot override its isolated target`,
      );
    }
  }

  return {
    ...input,
    SENTRIS_INSTANCE: instance,
    SENTRIS_DEPLOYMENT_ID: input.SENTRIS_DEPLOYMENT_ID?.trim() || 'sentris-production-smoke',
    SENTRIS_TRUST_PROFILE: trustProfile,
    AUTH_PROVIDER: hardened ? 'clerk' : 'local',
    VITE_AUTH_PROVIDER: hardened ? 'clerk' : 'local',
    CLERK_PUBLISHABLE_KEY: clerkPublishableKey,
    CLERK_SECRET_KEY: clerkSecretKey,
    VITE_CLERK_PUBLISHABLE_KEY: clerkPublishableKey,
    MCP_DISCOVERY_TRUSTED_LOCAL_STDIO: hardened
      ? 'false'
      : input.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO?.trim() || 'false',
    ADMIN_USERNAME: input.ADMIN_USERNAME?.trim() || `sentris-smoke-${instance}`,
    ADMIN_PASSWORD: input.ADMIN_PASSWORD?.trim() || randomToken(),
    SESSION_SECRET: input.SESSION_SECRET?.trim() || randomToken(),
    INTERNAL_SERVICE_TOKEN: internalServiceToken,
    E2E_INTERNAL_SERVICE_TOKEN: internalServiceToken,
    E2E_API_BASE_URL: e2eApiBaseUrl,
    SECRET_STORE_MASTER_KEY: input.SECRET_STORE_MASTER_KEY?.trim() || randomToken(16),
    MCP_DOCKER_PROXY_TOKEN: input.MCP_DOCKER_PROXY_TOKEN?.trim() || randomToken(),
    WORKER_ORPHAN_MIN_AGE_MS: input.WORKER_ORPHAN_MIN_AGE_MS?.trim() || '0',
    WORKER_ORPHAN_INTERVAL_MS: input.WORKER_ORPHAN_INTERVAL_MS?.trim() || '1000',
    SENTRIS_ALLOW_LIFECYCLE_DURABILITY_SMOKE: lifecycleDurabilityApproved ? 'true' : undefined,
    LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME: lifecycleDatabase,
    LIFECYCLE_DURABILITY_SMOKE_DATABASE_URL: lifecycleDatabaseUrl,
    LIFECYCLE_DURABILITY_SMOKE_PGOPTIONS: LIFECYCLE_PGOPTIONS,
    DRIZZLE_DATABASE_URL: lifecycleDatabaseUrl,
    SENTRIS_ALLOW_FINDINGS_OPENSEARCH_SMOKE: findingsOpenSearchApproved ? 'true' : undefined,
    SENTRIS_ALLOW_PRODUCTION_BROWSER_JOURNEY: browserJourneyApproved ? 'true' : undefined,
    SENTRIS_FINDINGS_OPENSEARCH_DISPOSABLE_PROJECT: 'true',
    SENTRIS_FINDINGS_OPENSEARCH_RELEASE_MODE: 'true',
    FINDINGS_OPENSEARCH_SMOKE_API_BASE_URL: findingsOpenSearchApiBaseUrl,
    FINDINGS_OPENSEARCH_SMOKE_INTERNAL_TOKEN: internalServiceToken,
    FINDINGS_OPENSEARCH_SMOKE_OPENSEARCH_URL: findingsOpenSearchUrl,
    FINDINGS_OPENSEARCH_SMOKE_DATABASE_URL: findingsOpenSearchDatabaseUrl,
    FINDINGS_OPENSEARCH_SMOKE_PIT_HOLD_MS: findingsOpenSearchPitHoldMs,
    FINDINGS_RECONCILIATION_SCHEDULE_ENABLED: hardened ? 'true' : 'false',
    SENTRIS_PUBLIC_API_BASE_URL: nginxUrl,
    SENTRIS_SMOKE_NGINX_URL: nginxUrl,
    COMPOSE_PROJECT_NAME: input.COMPOSE_PROJECT_NAME?.trim() || composeProjectName,
  };
}

function composeCommand(name, args, timeoutMs = DEFAULT_STEP_TIMEOUT_MS) {
  return {
    name,
    command: 'docker',
    args: [...composePrefix, ...args],
    timeoutMs,
  };
}

const requiredWorkerDependencies = [
  'temporal',
  'dind',
  'postgres',
  'minio',
  'redis',
  'redpanda',
  'backend',
];

function buildDependencyRecoveryCommands(waitTimeoutSeconds) {
  const restartWaitSeconds = Math.min(waitTimeoutSeconds, 120);
  return requiredWorkerDependencies.flatMap((dependency) => [
    composeCommand(`stop-${dependency}`, ['stop', '--timeout', '10', dependency], 30 * SECOND_MS),
    composeCommand(
      `observe-${dependency}-readiness-failure`,
      [
        'exec',
        '-T',
        'worker',
        'sh',
        '-ec',
        `
body="/tmp/sentris-${dependency}-readiness.json"
attempt=0
while [ "$attempt" -lt 30 ]; do
  code="$(curl -sS -o "$body" -w "%{http_code}" http://localhost:9100/health/ready || true)"
  test "$code" = "503" && exit 0
  attempt=$((attempt + 1))
  sleep 1
done
cat "$body" >&2 2>/dev/null || true
echo "Worker readiness did not fail while ${dependency} was stopped (last HTTP $code)" >&2
exit 1
      `.trim(),
      ],
      LIFECYCLE_DATABASE_COMMAND_TIMEOUT_MS,
    ),
    composeCommand(
      `start-${dependency}`,
      ['up', '-d', '--wait', '--wait-timeout', String(restartWaitSeconds), dependency],
      (restartWaitSeconds + 30) * SECOND_MS,
    ),
    composeCommand(
      `recover-${dependency}-readiness`,
      [
        'exec',
        '-T',
        'worker',
        'sh',
        '-ec',
        `
attempt=0
while [ "$attempt" -lt 90 ]; do
  curl -sf http://localhost:9100/health/ready >/dev/null && exit 0
  attempt=$((attempt + 1))
  sleep 1
done
echo "${dependency} readiness did not recover" >&2
curl -sS http://localhost:9100/health/ready >&2 || true
exit 1
      `.trim(),
      ],
      105 * SECOND_MS,
    ),
  ]);
}

function buildFindingsOpenSearchAcceptanceCommands() {
  return [
    composeCommand(
      'findings-opensearch-stop',
      ['stop', '--timeout', '10', 'opensearch'],
      30 * SECOND_MS,
    ),
    composeCommand(
      'findings-opensearch-unavailable',
      [
        'exec',
        '-T',
        '-e',
        'FINDINGS_OPENSEARCH_SMOKE_INTERNAL_TOKEN',
        '-e',
        'SENTRIS_INSTANCE',
        'backend',
        'sh',
        '-ec',
        `
body="/tmp/sentris-findings-opensearch-unavailable.json"
status="$(curl -sS --connect-timeout 5 --max-time 45 -o "$body" -w "%{http_code}" \
  -H "x-internal-token: $FINDINGS_OPENSEARCH_SMOKE_INTERNAL_TOKEN" \
  -H "x-organization-id: findings-opensearch-outage-i$SENTRIS_INSTANCE" \
  "http://localhost:3211/api/v1/findings?paginationMode=cursor&pageSize=1" || true)"
test "$status" = "503" || {
  cat "$body" >&2 2>/dev/null || true
  echo "Findings did not fail closed while OpenSearch was stopped (HTTP $status)" >&2
  exit 1
}
        `.trim(),
      ],
      60 * SECOND_MS,
    ),
    composeCommand(
      'findings-opensearch-restart',
      ['up', '-d', '--wait', '--wait-timeout', '120', 'opensearch'],
      150 * SECOND_MS,
    ),
    composeCommand(
      'findings-opensearch-backend-recovered',
      [
        'exec',
        '-T',
        'backend',
        'sh',
        '-ec',
        `
attempt=0
while [ "$attempt" -lt 90 ]; do
  curl -sf http://localhost:3211/health/ready >/dev/null && exit 0
  attempt=$((attempt + 1))
  sleep 1
done
echo "Backend readiness did not recover after the OpenSearch outage" >&2
curl -sS http://localhost:3211/health/ready >&2 || true
exit 1
        `.trim(),
      ],
      105 * SECOND_MS,
    ),
    composeCommand(
      'findings-opensearch-acceptance',
      [
        'exec',
        '-T',
        '-e',
        'CI',
        '-e',
        'SENTRIS_INSTANCE',
        '-e',
        'COMPOSE_PROJECT_NAME',
        '-e',
        'SENTRIS_ALLOW_FINDINGS_OPENSEARCH_SMOKE',
        '-e',
        'SENTRIS_FINDINGS_OPENSEARCH_DISPOSABLE_PROJECT',
        '-e',
        'SENTRIS_FINDINGS_OPENSEARCH_RELEASE_MODE',
        '-e',
        'FINDINGS_OPENSEARCH_SMOKE_API_BASE_URL',
        '-e',
        'FINDINGS_OPENSEARCH_SMOKE_INTERNAL_TOKEN',
        '-e',
        'FINDINGS_OPENSEARCH_SMOKE_OPENSEARCH_URL',
        '-e',
        'FINDINGS_OPENSEARCH_SMOKE_DATABASE_URL',
        '-e',
        'FINDINGS_OPENSEARCH_SMOKE_PIT_HOLD_MS',
        'backend',
        'sh',
        '-ec',
        'exec timeout --signal=TERM --kill-after=15 1470 bun run smoke:findings-opensearch',
      ],
      FINDINGS_OPENSEARCH_HARNESS_TIMEOUT_MS,
    ),
  ];
}

function buildSmokeCommands(waitTimeoutSeconds = 300, trustProfile = 'trusted-local') {
  if (!Number.isInteger(waitTimeoutSeconds) || waitTimeoutSeconds < 1) {
    throw new Error('Production Compose smoke wait timeout must be a positive integer');
  }
  if (trustProfile !== 'trusted-local' && trustProfile !== 'hardened') {
    throw new Error('Production Compose smoke trust profile must be trusted-local or hardened');
  }
  return [
    composeCommand('config', ['config', '--quiet'], 30 * SECOND_MS),
    composeCommand('build', ['build'], waitTimeoutSeconds * SECOND_MS),
    composeCommand(
      'up',
      [
        'up',
        '-d',
        '--wait',
        '--wait-timeout',
        String(waitTimeoutSeconds),
        '--scale',
        'opensearch-init=0',
      ],
      (waitTimeoutSeconds + 60) * SECOND_MS,
    ),
    composeCommand(
      'opensearch-init',
      ['run', '--rm', '--no-deps', 'opensearch-init'],
      OPENSEARCH_INIT_TIMEOUT_MS,
    ),
    composeCommand(
      'temporal-namespace',
      [
        'exec',
        '-T',
        'temporal',
        'tctl',
        '--address',
        'temporal:7233',
        '--namespace',
        'sentris-prod',
        'namespace',
        'describe',
      ],
      30 * SECOND_MS,
    ),
    composeCommand(
      'backend-readiness',
      ['exec', '-T', 'backend', 'curl', '-sf', 'http://localhost:3211/health/ready'],
      30 * SECOND_MS,
    ),
    composeCommand(
      'worker-readiness',
      ['exec', '-T', 'worker', 'curl', '-sf', 'http://localhost:9100/health/ready'],
      30 * SECOND_MS,
    ),
    composeCommand('dind-readiness', ['exec', '-T', 'dind', 'docker', 'info'], 30 * SECOND_MS),
    composeCommand(
      'mcp-proxy-auth',
      [
        'exec',
        '-T',
        '-e',
        'MCP_DOCKER_PROXY_TOKEN',
        'backend',
        'sh',
        '-ec',
        'status=$(curl -s -o /dev/null -w "%{http_code}" -H "x-sentris-mcp-proxy-token: $MCP_DOCKER_PROXY_TOKEN" http://worker:9101/); test "$status" = 404',
      ],
      30 * SECOND_MS,
    ),
    ...buildDependencyRecoveryCommands(waitTimeoutSeconds),
    composeCommand(
      'post-fault-backend-readiness',
      [
        'exec',
        '-T',
        'backend',
        'sh',
        '-ec',
        `
attempt=0
while [ "$attempt" -lt 90 ]; do
  curl -sf http://localhost:3211/health/ready >/dev/null && exit 0
  attempt=$((attempt + 1))
  sleep 1
done
echo "Backend readiness did not recover after dependency fault injection" >&2
curl -sS http://localhost:3211/health/ready >&2 || true
exit 1
      `.trim(),
      ],
      105 * SECOND_MS,
    ),
    composeCommand(
      'post-fault-worker-readiness',
      ['exec', '-T', 'worker', 'curl', '-sf', 'http://localhost:9100/health/ready'],
      30 * SECOND_MS,
    ),
    ...(trustProfile === 'trusted-local' ? buildFindingsOpenSearchAcceptanceCommands() : []),
    composeCommand(
      'lifecycle-db-reset',
      [
        'exec',
        '-T',
        '-e',
        'SENTRIS_INSTANCE',
        '-e',
        'LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME',
        'postgres',
        'sh',
        '-ec',
        `
expected="sentris_lifecycle_smoke_i\${SENTRIS_INSTANCE}"
test "$LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME" = "$expected" || {
  echo "Refusing lifecycle database reset for unexpected target $LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME" >&2
  exit 1
}
echo "Lifecycle database reset target: $LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME"
PGCONNECT_TIMEOUT=10 timeout -s TERM -k 5 14 dropdb --if-exists --force --username "$POSTGRES_USER" "$LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME"
PGCONNECT_TIMEOUT=10 timeout -s TERM -k 5 14 createdb --username "$POSTGRES_USER" "$LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME"
        `.trim(),
      ],
      LIFECYCLE_DATABASE_COMMAND_TIMEOUT_MS,
    ),
    composeCommand(
      'lifecycle-db-migrate',
      [
        'exec',
        '-T',
        '-e',
        'DRIZZLE_DATABASE_URL',
        '-e',
        'LIFECYCLE_DURABILITY_SMOKE_PGOPTIONS',
        'backend',
        'sh',
        '-ec',
        'export PGOPTIONS="$LIFECYCLE_DURABILITY_SMOKE_PGOPTIONS"; exec timeout --signal=TERM --kill-after=15 210 bun run migration:run',
      ],
      LIFECYCLE_MIGRATION_TIMEOUT_MS,
    ),
    composeCommand(
      'lifecycle-db-quiescent',
      [
        'exec',
        '-T',
        '-e',
        'SENTRIS_INSTANCE',
        '-e',
        'LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME',
        'postgres',
        'sh',
        '-ec',
        `
expected="sentris_lifecycle_smoke_i\${SENTRIS_INSTANCE}"
test "$LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME" = "$expected" || {
  echo "Refusing lifecycle database quiescence check for unexpected target $LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME" >&2
  exit 1
}
count="$(
  PGCONNECT_TIMEOUT=10 timeout -s TERM -k 5 15 psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --no-align --set=smoke_db="$LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME" --file=- <<'SQL'
SELECT count(*) FROM pg_stat_activity WHERE datname = :'smoke_db';
SQL
)"
test "$count" = "0" || {
  echo "Lifecycle database has $count unexpected consumer connection(s)" >&2
  exit 1
}
        `.trim(),
      ],
      30 * SECOND_MS,
    ),
    composeCommand(
      'lifecycle-durability',
      [
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
      LIFECYCLE_HARNESS_TIMEOUT_MS,
    ),
    composeCommand(
      'lifecycle-db-drop',
      [
        'exec',
        '-T',
        '-e',
        'SENTRIS_INSTANCE',
        '-e',
        'LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME',
        'postgres',
        'sh',
        '-ec',
        `
expected="sentris_lifecycle_smoke_i\${SENTRIS_INSTANCE}"
test "$LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME" = "$expected" || {
  echo "Refusing lifecycle database drop for unexpected target $LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME" >&2
  exit 1
}
echo "Lifecycle database drop target: $LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME"
PGCONNECT_TIMEOUT=10 timeout -s TERM -k 5 20 dropdb --if-exists --force --username "$POSTGRES_USER" "$LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME"
        `.trim(),
      ],
      LIFECYCLE_DATABASE_COMMAND_TIMEOUT_MS,
    ),
    {
      name: 'worker-crash-recovery',
      command: 'bun',
      args: ['run', 'smoke:worker-crash-recovery'],
      timeoutMs: 360 * SECOND_MS,
    },
    {
      name: 'critical-journey',
      command: 'bun',
      args: ['run', 'test:e2e:release'],
      timeoutMs: 600 * SECOND_MS,
    },
    ...(trustProfile === 'trusted-local'
      ? [
          {
            name: 'browser-target-journey',
            command: 'bun',
            args: ['run', 'smoke:browser-target-journey'],
            timeoutMs: 600 * SECOND_MS,
          },
        ]
      : []),
    composeCommand(
      'managed-resource-cleanup',
      [
        'exec',
        '-T',
        '-e',
        'SENTRIS_DEPLOYMENT_ID',
        '-e',
        'SENTRIS_INSTANCE',
        'dind',
        'sh',
        '-ec',
        `
containers="$(docker ps -aq \
  --filter "label=sentris.managed=true" \
  --filter "label=sentris.deploymentId=$SENTRIS_DEPLOYMENT_ID" \
  --filter "label=sentris.instance=$SENTRIS_INSTANCE" \
  --filter "label=sentris.temporalNamespace=sentris-prod" \
  --filter "label=sentris.temporalTaskQueue=sentris-prod")"
test -z "$containers" || {
  echo "Managed Sentris containers remain after the critical journey" >&2
  docker ps -a --filter "label=sentris.managed=true" >&2
  exit 1
}
volumes="$(docker volume ls -q \
  --filter "label=sentris.managed=true" \
  --filter "label=sentris.deploymentId=$SENTRIS_DEPLOYMENT_ID" \
  --filter "label=sentris.instance=$SENTRIS_INSTANCE" \
  --filter "label=sentris.temporalNamespace=sentris-prod" \
  --filter "label=sentris.temporalTaskQueue=sentris-prod")"
test -z "$volumes" || {
  echo "Managed Sentris volumes remain after the critical journey" >&2
  docker volume ls --filter "label=sentris.managed=true" >&2
  exit 1
}
test -z "$(find /sentris-docker-io/runs -mindepth 1 -maxdepth 1 -print -quit)" || {
  echo "Run-scoped exchange directories remain after the critical journey" >&2
  find /sentris-docker-io/runs -mindepth 1 -maxdepth 2 -print >&2
  exit 1
}
test -z "$(find /sentris-docker-io/metadata -mindepth 1 -maxdepth 1 -print -quit)" || {
  echo "Run-scoped exchange metadata remains after the critical journey" >&2
  find /sentris-docker-io/metadata -mindepth 1 -maxdepth 1 -print >&2
  exit 1
}
      `.trim(),
      ],
      120 * SECOND_MS,
    ),
    ...(trustProfile === 'trusted-local'
      ? [
          {
            name: 'telemetry-durability',
            command: 'node',
            args: ['scripts/telemetry-durability-compose-smoke.js'],
            timeoutMs: TELEMETRY_DURABILITY_COMPOSE_TIMEOUT_MS,
          },
        ]
      : []),
    composeCommand('down', ['down', '-v', '--remove-orphans'], 300 * SECOND_MS),
  ];
}

function calculateSmokeWorstCaseSeconds(waitTimeoutSeconds = 300, trustProfile = 'trusted-local') {
  const commands = buildSmokeCommands(waitTimeoutSeconds, trustProfile);
  const findingsOutageRecoveryRetryMs = commands
    .filter(
      (command) =>
        command.name === 'findings-opensearch-restart' ||
        command.name === 'findings-opensearch-backend-recovered',
    )
    .reduce((total, command) => total + command.timeoutMs, 0);
  return Math.ceil(
    (commands.reduce((total, command) => total + command.timeoutMs, 0) +
      NGINX_PROBE_TIMEOUT_MS +
      LIFECYCLE_DATABASE_COMMAND_TIMEOUT_MS +
      findingsOutageRecoveryRetryMs) /
      SECOND_MS,
  );
}

function terminateProcessTree(
  child,
  signal,
  {
    platform = process.platform,
    spawnImpl = spawn,
    schedule = setTimeout,
    cancel = clearTimeout,
  } = {},
) {
  if (!Number.isInteger(child.pid) || child.pid < 1) return Promise.resolve();
  if (platform === 'win32') {
    return new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let fallbackTimer;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (fallbackTimer !== undefined) cancel(fallbackTimer);
        if (error) rejectPromise(error);
        else resolvePromise();
      };
      const fallback = (cause) => {
        if (settled) return;
        if (signal === 'SIGKILL') {
          try {
            child.kill('SIGKILL');
          } catch (fallbackError) {
            if (cause === undefined) cause = fallbackError;
          }
        }
        const error = new Error(
          `could not prove Windows process-tree termination for PID ${child.pid}`,
        );
        if (cause !== undefined) error.cause = cause;
        finish(error);
      };

      try {
        const args = ['/pid', String(child.pid), '/t'];
        if (signal === 'SIGKILL') args.push('/f');
        const taskkill = spawnImpl('taskkill', args, {
          stdio: 'ignore',
          windowsHide: true,
        });
        taskkill.once('error', (error) => fallback(error));
        taskkill.once('close', (status) => {
          if (status === 0) finish();
          else fallback(new Error(`taskkill exited with status ${status ?? 'unknown'}`));
        });
        if (signal === 'SIGKILL') {
          fallbackTimer = schedule(
            () => fallback(new Error('taskkill did not settle within 750ms')),
            750,
          );
          fallbackTimer?.unref?.();
        }
        taskkill.unref();
      } catch (error) {
        fallback(error);
      }
    });
  }

  try {
    process.kill(-child.pid, signal);
    return Promise.resolve();
  } catch (error) {
    if (error && error.code === 'ESRCH') return Promise.resolve();
    try {
      child.kill(signal);
      return Promise.resolve();
    } catch (fallbackError) {
      return Promise.reject(fallbackError);
    }
  }
}

function runCommand(
  step,
  env,
  {
    spawnImpl = spawn,
    schedule = setTimeout,
    cancel = clearTimeout,
    signalProcessTree = terminateProcessTree,
  } = {},
) {
  console.log(`[production-compose-smoke] ${step.name}`);
  const captureStdout = step.captureStdout === true;
  const maxOutputBytes = step.maxOutputBytes ?? 4_096;
  if (captureStdout && (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1)) {
    return Promise.reject(new Error(`${step.name} requires a positive maxOutputBytes bound`));
  }
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timedOut = false;
    let terminationFailure;
    let childClosed = false;
    let softStarted = false;
    let softSettled = false;
    let killStarted = false;
    let killSettled = false;
    let killFailed = false;
    let capturedBytes = 0;
    let capturedOutputExceeded = false;
    let capturedOutputError;
    const capturedChunks = [];
    let child;
    try {
      child = spawnImpl(step.command, step.args, {
        cwd: step.cwd || repoRoot,
        env,
        stdio: captureStdout ? ['inherit', 'pipe', 'inherit'] : 'inherit',
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }
    if (captureStdout) {
      if (!child.stdout || typeof child.stdout.on !== 'function') {
        capturedOutputError = new Error(`${step.name} did not expose captured stdout`);
      } else {
        child.stdout.on('data', (chunk) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
          capturedBytes += bytes.length;
          if (capturedBytes > maxOutputBytes) {
            capturedOutputExceeded = true;
            return;
          }
          capturedChunks.push(bytes);
        });
        child.stdout.on('error', (error) => {
          capturedOutputError = error;
        });
      }
    }

    let softTimer;
    let killTimer;
    let hardTimer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cancel(softTimer);
      cancel(killTimer);
      cancel(hardTimer);
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const timeoutError = (cleanupUnsafe = false) => {
      const error = new Error(
        cleanupUnsafe
          ? `${step.name} exceeded its ${Math.ceil(
              step.timeoutMs / SECOND_MS,
            )}-second hard process bound; process-tree settlement was not proved, so follow-on cleanup is suppressed`
          : `${step.name} exceeded its ${Math.ceil(
              step.timeoutMs / SECOND_MS,
            )}-second hard process bound`,
      );
      if (terminationFailure !== undefined) error.cause = terminationFailure;
      if (cleanupUnsafe) error.cleanupUnsafe = true;
      return error;
    };
    const requestSignal = async (signal) => {
      try {
        await signalProcessTree(child, signal);
        return true;
      } catch (error) {
        if (terminationFailure === undefined) terminationFailure = error;
        return false;
      }
    };
    const finishTimedOutIfSettled = () => {
      if (
        !timedOut ||
        !childClosed ||
        !softStarted ||
        !softSettled ||
        !killStarted ||
        !killSettled
      ) {
        return;
      }
      finish(timeoutError(killFailed));
    };
    const softDeadlineMs = Math.max(1, step.timeoutMs - PROCESS_TERMINATION_GRACE_MS);
    const killDeadlineMs = Math.max(softDeadlineMs, step.timeoutMs - PROCESS_KILL_SETTLEMENT_MS);
    softTimer = schedule(() => {
      if (settled) return;
      timedOut = true;
      softStarted = true;
      void requestSignal('SIGTERM').then(() => {
        softSettled = true;
        finishTimedOutIfSettled();
      });
    }, softDeadlineMs);
    killTimer = schedule(() => {
      if (settled) return;
      timedOut = true;
      killStarted = true;
      void requestSignal('SIGKILL').then((succeeded) => {
        killSettled = true;
        killFailed = !succeeded;
        finishTimedOutIfSettled();
      });
    }, killDeadlineMs);
    hardTimer = schedule(() => {
      if (settled) return;
      timedOut = true;
      const cleanupUnsafe =
        !childClosed || !softStarted || !softSettled || !killStarted || !killSettled || killFailed;
      try {
        if (cleanupUnsafe) child.unref?.();
      } catch (error) {
        if (terminationFailure === undefined) terminationFailure = error;
      }
      finish(timeoutError(cleanupUnsafe));
    }, step.timeoutMs);

    child.once('error', (error) => {
      if (timedOut) {
        terminationFailure = error;
        return;
      }
      finish(error);
    });
    child.once('close', (status, signal) => {
      childClosed = true;
      if (timedOut) {
        finishTimedOutIfSettled();
        return;
      }
      if (status !== 0) {
        const error = new Error(
          `${step.name} failed with ${
            status === null ? `signal ${signal ?? 'unknown'}` : `exit code ${status}`
          }`,
        );
        if (status === CLEANUP_UNSAFE_EXIT_CODE) error.cleanupUnsafe = true;
        finish(error);
        return;
      }
      if (capturedOutputError) {
        finish(capturedOutputError);
        return;
      }
      if (capturedOutputExceeded) {
        finish(new Error(`${step.name} exceeded its ${maxOutputBytes}-byte stdout capture bound`));
        return;
      }
      finish(undefined, captureStdout ? Buffer.concat(capturedChunks).toString('utf8') : undefined);
    });
  });
}

async function probeNginx(nginxUrl) {
  const healthUrl = new URL('/health', nginxUrl);
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException(`nginx health probe exceeded ${NGINX_PROBE_TIMEOUT_MS}ms`, 'TimeoutError'),
      ),
    NGINX_PROBE_TIMEOUT_MS,
  );
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`nginx health probe returned HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function executeSmokeCommandPlan(
  commands,
  env,
  { runStep = runCommand, probeNginx: probe = probeNginx } = {},
) {
  const cleanup = commands.at(-1);
  const config = commands.find((step) => step.name === 'config');
  const build = commands.find((step) => step.name === 'build');
  const up = commands.find((step) => step.name === 'up');
  const lifecycleReset = commands.find((step) => step.name === 'lifecycle-db-reset');
  const lifecycleDrop = commands.find((step) => step.name === 'lifecycle-db-drop');
  const findingsOpenSearchStop = commands.find((step) => step.name === 'findings-opensearch-stop');
  const findingsOpenSearchRestart = commands.find(
    (step) => step.name === 'findings-opensearch-restart',
  );
  const findingsOpenSearchBackendRecovered = commands.find(
    (step) => step.name === 'findings-opensearch-backend-recovered',
  );
  const opensearchInit = commands.find((step) => step.name === 'opensearch-init');
  let upAttempted = false;
  let lifecycleResetAttempted = false;
  let lifecycleDropCompleted = false;
  let findingsOpenSearchStopAttempted = false;
  let findingsOpenSearchRestartCompleted = false;
  let findingsOpenSearchBackendRecoveryCompleted = false;
  let primaryError;
  let cleanupSafe = true;

  try {
    await runStep(config, env);
    await runStep(build, env);
    upAttempted = true;
    await runStep(up, env);
    await runStep(opensearchInit, env);
    await probe(env.SENTRIS_SMOKE_NGINX_URL);
    for (const step of commands) {
      if (
        step === config ||
        step === build ||
        step === up ||
        step === opensearchInit ||
        step === cleanup
      ) {
        continue;
      }
      if (step === lifecycleReset) lifecycleResetAttempted = true;
      if (step === findingsOpenSearchStop) findingsOpenSearchStopAttempted = true;
      await runStep(step, env);
      if (step === lifecycleDrop) lifecycleDropCompleted = true;
      if (step === findingsOpenSearchRestart) findingsOpenSearchRestartCompleted = true;
      if (step === findingsOpenSearchBackendRecovered) {
        findingsOpenSearchBackendRecoveryCompleted = true;
      }
    }
    console.log('[production-compose-smoke] clean-start smoke passed');
  } catch (error) {
    primaryError = error;
    cleanupSafe = !isCleanupUnsafeError(error);
  } finally {
    if (
      cleanupSafe &&
      findingsOpenSearchStopAttempted &&
      (!findingsOpenSearchRestartCompleted || !findingsOpenSearchBackendRecoveryCompleted)
    ) {
      try {
        if (!findingsOpenSearchRestartCompleted && findingsOpenSearchRestart) {
          await runStep(findingsOpenSearchRestart, env);
          findingsOpenSearchRestartCompleted = true;
        }
        if (
          findingsOpenSearchRestartCompleted &&
          !findingsOpenSearchBackendRecoveryCompleted &&
          findingsOpenSearchBackendRecovered
        ) {
          await runStep(findingsOpenSearchBackendRecovered, env);
          findingsOpenSearchBackendRecoveryCompleted = true;
        }
      } catch (cleanupError) {
        if (isCleanupUnsafeError(cleanupError)) cleanupSafe = false;
        if (!primaryError) primaryError = cleanupError;
        else {
          console.error(
            `[production-compose-smoke] OpenSearch recovery also failed: ${
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            }`,
          );
        }
      }
    }
    if (cleanupSafe && lifecycleResetAttempted && !lifecycleDropCompleted && lifecycleDrop) {
      try {
        await runStep(lifecycleDrop, env);
        lifecycleDropCompleted = true;
      } catch (cleanupError) {
        if (isCleanupUnsafeError(cleanupError)) cleanupSafe = false;
        if (!primaryError) primaryError = cleanupError;
        else {
          console.error(
            `[production-compose-smoke] lifecycle database cleanup also failed: ${
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            }`,
          );
        }
      }
    }
    if (cleanupSafe && upAttempted && cleanup && env.SENTRIS_PRODUCTION_SMOKE_KEEP !== 'true') {
      try {
        await runStep(cleanup, env);
      } catch (cleanupError) {
        if (isCleanupUnsafeError(cleanupError)) cleanupSafe = false;
        if (!primaryError) primaryError = cleanupError;
        else {
          console.error(
            `[production-compose-smoke] cleanup also failed: ${
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            }`,
          );
        }
      }
    }
  }

  if (primaryError) throw primaryError;
}

function isCleanupUnsafeError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, 'cleanupUnsafe') &&
    error.cleanupUnsafe === true
  );
}

function assertTelemetryProductionPreconditions(input, trustProfile) {
  if (trustProfile !== 'trusted-local') return;
  const instance = input.SENTRIS_INSTANCE?.trim();
  const expectedProject = `sentris-production-smoke-${instance}`;
  if (input.COMPOSE_PROJECT_NAME?.trim() !== expectedProject) {
    throw new Error(`COMPOSE_PROJECT_NAME must be ${expectedProject}`);
  }
  if (input.SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT !== 'true') {
    throw new Error(
      'Trusted-local production Compose smoke requires SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT=true',
    );
  }
  if (input.SENTRIS_PRODUCTION_SMOKE_KEEP === 'true') {
    throw new Error(
      'SENTRIS_PRODUCTION_SMOKE_KEEP=true is incompatible with the destructive trusted-local telemetry durability smoke',
    );
  }
}

async function runProductionComposeSmoke(input = process.env) {
  if (input.CI !== 'true' && input.SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE !== 'true') {
    throw new Error(
      'Production Compose smoke is destructive; run in CI or set SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE=true',
    );
  }
  const env = resolveSmokeEnvironment(input);
  assertTelemetryProductionPreconditions(env, env.SENTRIS_TRUST_PROFILE);
  const waitTimeoutSeconds = Number.parseInt(
    env.SENTRIS_PRODUCTION_SMOKE_WAIT_SECONDS || '300',
    10,
  );
  const commands = buildSmokeCommands(waitTimeoutSeconds, env.SENTRIS_TRUST_PROFILE);
  await executeSmokeCommandPlan(commands, env);
}

if (require.main === module) {
  runProductionComposeSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  CLEANUP_UNSAFE_EXIT_CODE,
  assertTelemetryProductionPreconditions,
  buildSmokeCommands,
  calculateSmokeWorstCaseSeconds,
  executeSmokeCommandPlan,
  isCleanupUnsafeError,
  resolveSmokeEnvironment,
  runCommand,
  runProductionComposeSmoke,
  terminateProcessTree,
};
