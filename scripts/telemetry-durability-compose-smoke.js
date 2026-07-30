#!/usr/bin/env node

const { randomUUID } = require('node:crypto');

const {
  CLEANUP_UNSAFE_EXIT_CODE,
  isCleanupUnsafeError,
  runCommand,
} = require('./production-compose-smoke.js');

const SECOND_MS = 1_000;
const composePrefix = ['compose', '-f', 'docker/docker-compose.full.yml'];
const TELEMETRY_DURABILITY_PHASE_TIMEOUT_MS = 210 * SECOND_MS;
const TELEMETRY_DURABILITY_COMPOSE_TIMEOUT_MS = 1_920 * SECOND_MS;
const BACKEND_GENERATION_CAPTURE_BYTES = 128;
const BACKEND_GENERATION_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TELEMETRY_DURABILITY_LIVE_COVERAGE = Object.freeze({
  liveProjection: Object.freeze(['events', 'logs']),
  readinessGate: Object.freeze(['events', 'logs', 'agent-trace', 'node-io']),
  staticSharedMechanismOnly: Object.freeze(['agent-trace', 'node-io']),
});

const telemetryPhases = new Set([
  'direct',
  'fallback',
  'await-dead',
  'recover',
  'poison',
  'cleanup',
]);
const wrapperOwnedEnvironment = [
  'TELEMETRY_DURABILITY_SMOKE_SUITE_ID',
  'TELEMETRY_DURABILITY_SMOKE_STARTED_AT',
  'TELEMETRY_DURABILITY_SMOKE_PHASE',
  'TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_BEFORE',
  'TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_AFTER',
];
const phaseEnvironment = [
  'SENTRIS_ALLOW_TELEMETRY_DURABILITY_SMOKE',
  'SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT',
  'SENTRIS_INSTANCE',
  'COMPOSE_PROJECT_NAME',
  'TELEMETRY_DURABILITY_SMOKE_DATABASE_URL',
  'TELEMETRY_DURABILITY_SMOKE_BACKEND_URL',
  'TELEMETRY_DURABILITY_SMOKE_INTERNAL_TOKEN',
  'TELEMETRY_DURABILITY_SMOKE_KAFKA_BROKERS',
  'TELEMETRY_DURABILITY_SMOKE_EVENT_TOPIC_BASE',
  'TELEMETRY_DURABILITY_SMOKE_LOG_TOPIC_BASE',
  'TELEMETRY_DURABILITY_SMOKE_EVENT_GROUP_ID',
  'TELEMETRY_DURABILITY_SMOKE_LOG_GROUP_ID',
  'TELEMETRY_DURABILITY_SMOKE_LOKI_URL',
  'TELEMETRY_DURABILITY_SMOKE_SUITE_ID',
  'TELEMETRY_DURABILITY_SMOKE_STARTED_AT',
  'TELEMETRY_DURABILITY_SMOKE_PHASE',
];

function requiredEnvironment(input, name) {
  const value = input[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set explicitly for the telemetry durability Compose smoke`);
  }
  return value;
}

function resolveTelemetryComposeEnvironment(input = process.env) {
  const instance = input.SENTRIS_INSTANCE?.trim();
  if (!instance) {
    throw new Error('SENTRIS_INSTANCE must be set explicitly for the telemetry durability smoke');
  }
  if (!/^\d$/.test(instance)) {
    throw new Error('SENTRIS_INSTANCE must be an integer from 0 to 9');
  }
  if (input.SENTRIS_TRUST_PROFILE?.trim() !== 'trusted-local') {
    throw new Error('Telemetry durability production Compose smoke supports trusted-local only');
  }
  if (input.CI !== 'true' && input.SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE !== 'true') {
    throw new Error(
      'Telemetry durability production Compose smoke is destructive; run in CI or set SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE=true',
    );
  }
  if (input.SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT !== 'true') {
    throw new Error(
      'Telemetry durability production Compose smoke requires SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT=true',
    );
  }
  if (input.SENTRIS_PRODUCTION_SMOKE_KEEP === 'true') {
    throw new Error(
      'Telemetry durability production Compose smoke rejects SENTRIS_PRODUCTION_SMOKE_KEEP=true because Kafka and Loki volumes must be removed',
    );
  }

  const composeProject = `sentris-production-smoke-${instance}`;
  if (requiredEnvironment(input, 'COMPOSE_PROJECT_NAME') !== composeProject) {
    throw new Error(`COMPOSE_PROJECT_NAME must be ${composeProject}`);
  }
  const internalToken = requiredEnvironment(input, 'INTERNAL_SERVICE_TOKEN');
  const exactTargets = {
    TELEMETRY_DURABILITY_SMOKE_DATABASE_URL: 'postgresql://sentris:sentris@postgres:5432/sentris',
    TELEMETRY_DURABILITY_SMOKE_BACKEND_URL: 'http://localhost:3211',
    TELEMETRY_DURABILITY_SMOKE_INTERNAL_TOKEN: internalToken,
    TELEMETRY_DURABILITY_SMOKE_KAFKA_BROKERS: 'redpanda:9092',
    TELEMETRY_DURABILITY_SMOKE_EVENT_TOPIC_BASE: 'telemetry.events',
    TELEMETRY_DURABILITY_SMOKE_LOG_TOPIC_BASE: 'telemetry.logs',
    TELEMETRY_DURABILITY_SMOKE_EVENT_GROUP_ID: `sentris-event-ingestor-${instance}`,
    TELEMETRY_DURABILITY_SMOKE_LOG_GROUP_ID: `sentris-backend-log-consumer-${instance}`,
    TELEMETRY_DURABILITY_SMOKE_LOKI_URL: 'http://loki:3100',
  };
  for (const [name, expected] of Object.entries(exactTargets)) {
    const supplied = input[name]?.trim();
    if (supplied && supplied !== expected) {
      throw new Error(`${name} cannot override the production Compose telemetry target`);
    }
  }
  for (const name of [
    'TELEMETRY_DURABILITY_SMOKE_LOKI_TENANT_ID',
    'TELEMETRY_DURABILITY_SMOKE_LOKI_USERNAME',
    'TELEMETRY_DURABILITY_SMOKE_LOKI_PASSWORD',
  ]) {
    if (input[name]?.trim()) {
      throw new Error(`${name} cannot override the unauthenticated production Compose Loki target`);
    }
  }
  for (const name of wrapperOwnedEnvironment) {
    if (input[name]?.trim()) {
      throw new Error(`${name} is owned by the production Compose telemetry wrapper`);
    }
  }

  return {
    ...input,
    SENTRIS_INSTANCE: instance,
    SENTRIS_TRUST_PROFILE: 'trusted-local',
    COMPOSE_PROJECT_NAME: composeProject,
    SENTRIS_ALLOW_TELEMETRY_DURABILITY_SMOKE: 'true',
    SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: 'true',
    ...exactTargets,
    TELEMETRY_DURABILITY_SMOKE_LOKI_TENANT_ID: undefined,
    TELEMETRY_DURABILITY_SMOKE_LOKI_USERNAME: undefined,
    TELEMETRY_DURABILITY_SMOKE_LOKI_PASSWORD: undefined,
  };
}

function composeCommand(name, args, timeoutMs, extra = {}) {
  return {
    name,
    command: 'docker',
    args: [...composePrefix, ...args],
    timeoutMs,
    ...extra,
  };
}

function buildTelemetryPhaseCommand(phase, mode) {
  if (!telemetryPhases.has(phase)) {
    throw new Error(`Unsupported telemetry durability phase ${phase}`);
  }
  if (mode !== 'exec' && mode !== 'run') {
    throw new Error(`Unsupported telemetry durability Compose mode ${mode}`);
  }
  const names =
    phase === 'recover'
      ? [
          ...phaseEnvironment,
          'TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_BEFORE',
          'TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_AFTER',
        ]
      : phaseEnvironment;
  const environmentArguments = names.flatMap((name) => ['-e', name]);
  const modeArguments = mode === 'exec' ? ['exec', '-T'] : ['run', '--rm', '--no-deps'];
  return composeCommand(
    `telemetry-${phase}`,
    [
      ...modeArguments,
      ...environmentArguments,
      'backend',
      'timeout',
      '--signal=TERM',
      '--kill-after=5',
      '195',
      'bun',
      'run',
      'smoke:telemetry-durability',
    ],
    TELEMETRY_DURABILITY_PHASE_TIMEOUT_MS,
  );
}

function captureBackendGenerationCommand(name) {
  return composeCommand(name, ['ps', '--quiet', 'backend'], 30 * SECOND_MS, {
    captureStdout: true,
    maxOutputBytes: BACKEND_GENERATION_CAPTURE_BYTES,
  });
}

function backendGeneration(output, label) {
  if (typeof output !== 'string') {
    throw new Error(`${label} did not return a backend container ID`);
  }
  const value = output.trim();
  if (!BACKEND_GENERATION_PATTERN.test(value)) {
    throw new Error(`${label} returned an invalid backend container ID`);
  }
  return value;
}

function phaseEnvironmentFor(baseEnvironment, suiteId, startedAt, phase, generations = {}) {
  return {
    ...baseEnvironment,
    TELEMETRY_DURABILITY_SMOKE_SUITE_ID: suiteId,
    TELEMETRY_DURABILITY_SMOKE_STARTED_AT: startedAt,
    TELEMETRY_DURABILITY_SMOKE_PHASE: phase,
    ...generations,
  };
}

async function executeTelemetryComposeSmoke(
  input = process.env,
  { runStep = runCommand, randomUUID: createUuid = randomUUID, now = () => new Date() } = {},
) {
  const environment = resolveTelemetryComposeEnvironment(input);
  const suiteId = createUuid();
  if (!UUID_PATTERN.test(suiteId)) {
    throw new Error('Generated telemetry durability suite ID was not a UUID');
  }
  const startedAtDate = now();
  if (!(startedAtDate instanceof Date) || !Number.isFinite(startedAtDate.getTime())) {
    throw new Error('Generated telemetry durability start time was invalid');
  }
  const startedAt = startedAtDate.toISOString();
  const runPhase = (phase, mode, generations) =>
    runStep(
      buildTelemetryPhaseCommand(phase, mode),
      phaseEnvironmentFor(environment, suiteId, startedAt, phase, generations),
    );

  await runPhase('direct', 'exec');
  const backendGenerationBefore = backendGeneration(
    await runStep(captureBackendGenerationCommand('telemetry-capture-backend-before'), environment),
    'Backend generation capture before restart',
  );
  await runStep(
    composeCommand(
      'telemetry-stop-backend-for-fallback',
      ['stop', '--timeout', '10', 'backend'],
      30 * SECOND_MS,
    ),
    environment,
  );
  await runStep(
    composeCommand(
      'telemetry-stop-redpanda',
      ['stop', '--timeout', '10', 'redpanda'],
      30 * SECOND_MS,
    ),
    environment,
  );
  await runPhase('fallback', 'run');
  await runStep(
    composeCommand('telemetry-start-backend-kafka-down', ['start', 'backend'], 30 * SECOND_MS),
    environment,
  );
  await runStep(
    composeCommand(
      'telemetry-wait-backend-live-kafka-down',
      [
        'exec',
        '-T',
        'backend',
        'sh',
        '-ec',
        [
          'attempt=0',
          'while [ "$attempt" -lt 90 ]; do',
          '  curl -sf http://localhost:3211/health >/dev/null && exit 0',
          '  attempt=$((attempt + 1))',
          '  sleep 1',
          'done',
          'echo "Backend did not become live while Redpanda was stopped" >&2',
          'exit 1',
        ].join('\n'),
      ],
      105 * SECOND_MS,
    ),
    environment,
  );
  await runPhase('await-dead', 'exec');
  await runStep(
    composeCommand(
      'telemetry-stop-backend-for-restart',
      ['stop', '--timeout', '10', 'backend'],
      30 * SECOND_MS,
    ),
    environment,
  );
  await runStep(
    composeCommand(
      'telemetry-restart-redpanda',
      ['up', '-d', '--wait', '--wait-timeout', '120', 'redpanda'],
      150 * SECOND_MS,
    ),
    environment,
  );
  await runStep(
    composeCommand(
      'telemetry-recreate-backend',
      ['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'backend'],
      150 * SECOND_MS,
    ),
    environment,
  );
  const backendGenerationAfter = backendGeneration(
    await runStep(captureBackendGenerationCommand('telemetry-capture-backend-after'), environment),
    'Backend generation capture after restart',
  );
  if (backendGenerationAfter === backendGenerationBefore) {
    throw new Error('Backend container generation did not change after force-recreate');
  }
  await runPhase('recover', 'exec', {
    TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_BEFORE: backendGenerationBefore,
    TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_AFTER: backendGenerationAfter,
  });
  await runPhase('poison', 'exec');
  await runStep(
    composeCommand(
      'telemetry-stop-backend-for-cleanup',
      ['stop', '--timeout', '10', 'backend'],
      30 * SECOND_MS,
    ),
    environment,
  );
  await runPhase('cleanup', 'run');
}

function exitCodeForTelemetryComposeError(error) {
  return isCleanupUnsafeError(error) ? CLEANUP_UNSAFE_EXIT_CODE : 1;
}

if (require.main === module) {
  executeTelemetryComposeSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = exitCodeForTelemetryComposeError(error);
  });
}

module.exports = {
  CLEANUP_UNSAFE_EXIT_CODE,
  TELEMETRY_DURABILITY_COMPOSE_TIMEOUT_MS,
  TELEMETRY_DURABILITY_LIVE_COVERAGE,
  buildTelemetryPhaseCommand,
  executeTelemetryComposeSmoke,
  exitCodeForTelemetryComposeError,
  resolveTelemetryComposeEnvironment,
};
