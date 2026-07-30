import { describe, expect, it } from 'bun:test';

type TelemetryPhase = 'direct' | 'fallback' | 'await-dead' | 'recover' | 'poison' | 'cleanup';
type TelemetryMode = 'exec' | 'run';

interface SmokeStep {
  name: string;
  command: string;
  args: string[];
  timeoutMs: number;
  captureStdout?: boolean;
  maxOutputBytes?: number;
}

const telemetry = require('../telemetry-durability-compose-smoke.js') as {
  CLEANUP_UNSAFE_EXIT_CODE: number;
  TELEMETRY_DURABILITY_COMPOSE_TIMEOUT_MS: number;
  TELEMETRY_DURABILITY_LIVE_COVERAGE: {
    liveProjection: string[];
    readinessGate: string[];
    staticSharedMechanismOnly: string[];
  };
  resolveTelemetryComposeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  buildTelemetryPhaseCommand(phase: TelemetryPhase, mode: TelemetryMode): SmokeStep;
  executeTelemetryComposeSmoke(
    env: NodeJS.ProcessEnv,
    dependencies: {
      runStep(step: SmokeStep, env: NodeJS.ProcessEnv): Promise<string | void>;
      randomUUID(): string;
      now(): Date;
    },
  ): Promise<void>;
  exitCodeForTelemetryComposeError(error: unknown): number;
};

const SUITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STARTED_AT = '2026-07-29T10:11:12.345Z';
const OLD_BACKEND_ID = 'a'.repeat(64);
const NEW_BACKEND_ID = 'b'.repeat(64);
const INTERNAL_TOKEN = 'internal-token-secret';

function allowedEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SENTRIS_INSTANCE: '4',
    SENTRIS_TRUST_PROFILE: 'trusted-local',
    SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE: 'true',
    SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: 'true',
    COMPOSE_PROJECT_NAME: 'sentris-production-smoke-4',
    INTERNAL_SERVICE_TOKEN: INTERNAL_TOKEN,
    ...overrides,
  };
}

describe('production Compose telemetry durability wrapper', () => {
  it('requires an explicit approved disposable trusted-local production target', () => {
    expect(() =>
      telemetry.resolveTelemetryComposeEnvironment(allowedEnvironment({ SENTRIS_INSTANCE: '' })),
    ).toThrow('SENTRIS_INSTANCE must be set explicitly');
    expect(() =>
      telemetry.resolveTelemetryComposeEnvironment(allowedEnvironment({ SENTRIS_INSTANCE: '10' })),
    ).toThrow('SENTRIS_INSTANCE must be an integer from 0 to 9');
    expect(() =>
      telemetry.resolveTelemetryComposeEnvironment(
        allowedEnvironment({ SENTRIS_TRUST_PROFILE: 'hardened' }),
      ),
    ).toThrow('trusted-local');
    expect(() =>
      telemetry.resolveTelemetryComposeEnvironment(
        allowedEnvironment({
          SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE: undefined,
          CI: undefined,
        }),
      ),
    ).toThrow('run in CI or set SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE=true');
    expect(() =>
      telemetry.resolveTelemetryComposeEnvironment(
        allowedEnvironment({ SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: undefined }),
      ),
    ).toThrow('requires SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT=true');
    expect(() =>
      telemetry.resolveTelemetryComposeEnvironment(
        allowedEnvironment({ SENTRIS_PRODUCTION_SMOKE_KEEP: 'true' }),
      ),
    ).toThrow('SENTRIS_PRODUCTION_SMOKE_KEEP=true');
  });

  it('pins every harness target to the production Compose topology', () => {
    const env = telemetry.resolveTelemetryComposeEnvironment(allowedEnvironment());

    expect(env).toMatchObject({
      SENTRIS_INSTANCE: '4',
      SENTRIS_TRUST_PROFILE: 'trusted-local',
      COMPOSE_PROJECT_NAME: 'sentris-production-smoke-4',
      SENTRIS_ALLOW_TELEMETRY_DURABILITY_SMOKE: 'true',
      SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: 'true',
      TELEMETRY_DURABILITY_SMOKE_DATABASE_URL: 'postgresql://sentris:sentris@postgres:5432/sentris',
      TELEMETRY_DURABILITY_SMOKE_BACKEND_URL: 'http://localhost:3211',
      TELEMETRY_DURABILITY_SMOKE_INTERNAL_TOKEN: INTERNAL_TOKEN,
      TELEMETRY_DURABILITY_SMOKE_KAFKA_BROKERS: 'redpanda:9092',
      TELEMETRY_DURABILITY_SMOKE_EVENT_TOPIC_BASE: 'telemetry.events',
      TELEMETRY_DURABILITY_SMOKE_LOG_TOPIC_BASE: 'telemetry.logs',
      TELEMETRY_DURABILITY_SMOKE_EVENT_GROUP_ID: 'sentris-event-ingestor-4',
      TELEMETRY_DURABILITY_SMOKE_LOG_GROUP_ID: 'sentris-backend-log-consumer-4',
      TELEMETRY_DURABILITY_SMOKE_LOKI_URL: 'http://loki:3100',
    });
    expect(env.TELEMETRY_DURABILITY_SMOKE_LOKI_TENANT_ID).toBeUndefined();
    expect(env.TELEMETRY_DURABILITY_SMOKE_LOKI_USERNAME).toBeUndefined();
    expect(env.TELEMETRY_DURABILITY_SMOKE_LOKI_PASSWORD).toBeUndefined();
  });

  it('rejects target and generated-state override drift', () => {
    const wrongTargets: Array<[string, string]> = [
      ['COMPOSE_PROJECT_NAME', 'sentris-production-smoke-5'],
      [
        'TELEMETRY_DURABILITY_SMOKE_DATABASE_URL',
        'postgresql://sentris:sentris@postgres:5432/other',
      ],
      ['TELEMETRY_DURABILITY_SMOKE_BACKEND_URL', 'http://backend:3211'],
      ['TELEMETRY_DURABILITY_SMOKE_INTERNAL_TOKEN', 'different-token'],
      ['TELEMETRY_DURABILITY_SMOKE_KAFKA_BROKERS', 'other-broker:9092'],
      ['TELEMETRY_DURABILITY_SMOKE_EVENT_TOPIC_BASE', 'other.events'],
      ['TELEMETRY_DURABILITY_SMOKE_LOG_TOPIC_BASE', 'other.logs'],
      ['TELEMETRY_DURABILITY_SMOKE_EVENT_GROUP_ID', 'other-event-group'],
      ['TELEMETRY_DURABILITY_SMOKE_LOG_GROUP_ID', 'other-log-group'],
      ['TELEMETRY_DURABILITY_SMOKE_LOKI_URL', 'http://other-loki:3100'],
      ['TELEMETRY_DURABILITY_SMOKE_LOKI_TENANT_ID', 'other-tenant'],
      ['TELEMETRY_DURABILITY_SMOKE_LOKI_USERNAME', 'other-user'],
      ['TELEMETRY_DURABILITY_SMOKE_LOKI_PASSWORD', 'other-password'],
    ];
    for (const [name, value] of wrongTargets) {
      expect(() =>
        telemetry.resolveTelemetryComposeEnvironment(allowedEnvironment({ [name]: value })),
      ).toThrow(name);
    }

    for (const name of [
      'TELEMETRY_DURABILITY_SMOKE_SUITE_ID',
      'TELEMETRY_DURABILITY_SMOKE_STARTED_AT',
      'TELEMETRY_DURABILITY_SMOKE_PHASE',
      'TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_BEFORE',
      'TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_AFTER',
    ]) {
      expect(() =>
        telemetry.resolveTelemetryComposeEnvironment(allowedEnvironment({ [name]: 'operator' })),
      ).toThrow(`${name} is owned by the production Compose telemetry wrapper`);
    }
  });

  it('passes environment names instead of secret or target values in Docker arguments', () => {
    for (const [phase, mode] of [
      ['direct', 'exec'],
      ['fallback', 'run'],
      ['await-dead', 'exec'],
      ['recover', 'exec'],
      ['poison', 'exec'],
      ['cleanup', 'run'],
    ] as Array<[TelemetryPhase, TelemetryMode]>) {
      const step = telemetry.buildTelemetryPhaseCommand(phase, mode);
      const rendered = step.args.join(' ');

      expect(step.command).toBe('docker');
      expect(rendered).toContain('compose -f docker/docker-compose.full.yml');
      expect(rendered).toContain(mode === 'exec' ? 'exec -T' : 'run --rm --no-deps');
      expect(rendered).toContain('-e TELEMETRY_DURABILITY_SMOKE_PHASE');
      expect(rendered).toContain('backend timeout --signal=TERM --kill-after=5 195');
      expect(rendered).toContain('bun run smoke:telemetry-durability');
      expect(rendered).not.toContain(INTERNAL_TOKEN);
      expect(rendered).not.toContain('postgresql://');
      expect(rendered).not.toContain('redpanda:9092');
      expect(rendered).not.toContain('http://loki:3100');
    }
  });

  it('runs one generated suite through the six phases and a changed backend generation', async () => {
    const calls: Array<{ step: SmokeStep; env: NodeJS.ProcessEnv }> = [];
    const creationOrder: string[] = [];

    await telemetry.executeTelemetryComposeSmoke(allowedEnvironment(), {
      async runStep(step, env) {
        calls.push({ step, env: { ...env } });
        creationOrder.push(`run:${step.name}`);
        if (step.name === 'telemetry-capture-backend-before') return `${OLD_BACKEND_ID}\n`;
        if (step.name === 'telemetry-capture-backend-after') return `${NEW_BACKEND_ID}\n`;
      },
      randomUUID() {
        creationOrder.push('uuid');
        return SUITE_ID;
      },
      now() {
        creationOrder.push('now');
        return new Date(STARTED_AT);
      },
    });

    expect(creationOrder.slice(0, 3)).toEqual(['uuid', 'now', 'run:telemetry-direct']);
    expect(calls.map(({ step }) => step.name)).toEqual([
      'telemetry-direct',
      'telemetry-capture-backend-before',
      'telemetry-stop-backend-for-fallback',
      'telemetry-stop-redpanda',
      'telemetry-fallback',
      'telemetry-start-backend-kafka-down',
      'telemetry-wait-backend-live-kafka-down',
      'telemetry-await-dead',
      'telemetry-stop-backend-for-restart',
      'telemetry-restart-redpanda',
      'telemetry-recreate-backend',
      'telemetry-capture-backend-after',
      'telemetry-recover',
      'telemetry-poison',
      'telemetry-stop-backend-for-cleanup',
      'telemetry-cleanup',
    ]);

    const phaseCalls = calls.filter(({ env }) => env.TELEMETRY_DURABILITY_SMOKE_PHASE);
    expect(phaseCalls.map(({ env }) => env.TELEMETRY_DURABILITY_SMOKE_PHASE)).toEqual([
      'direct',
      'fallback',
      'await-dead',
      'recover',
      'poison',
      'cleanup',
    ]);
    expect(new Set(phaseCalls.map(({ env }) => env.TELEMETRY_DURABILITY_SMOKE_SUITE_ID))).toEqual(
      new Set([SUITE_ID]),
    );
    expect(new Set(phaseCalls.map(({ env }) => env.TELEMETRY_DURABILITY_SMOKE_STARTED_AT))).toEqual(
      new Set([STARTED_AT]),
    );

    const recover = phaseCalls.find(
      ({ env }) => env.TELEMETRY_DURABILITY_SMOKE_PHASE === 'recover',
    )!;
    expect(recover.env.TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_BEFORE).toBe(OLD_BACKEND_ID);
    expect(recover.env.TELEMETRY_DURABILITY_SMOKE_BACKEND_GENERATION_AFTER).toBe(NEW_BACKEND_ID);
    expect(calls.at(-2)?.step.args).toContain('stop');
    expect(calls.at(-1)?.step.args).toEqual(
      expect.arrayContaining(['run', '--rm', '--no-deps', 'backend']),
    );
  });

  it('refuses recovery when force-recreate did not change the backend container', async () => {
    const executed: string[] = [];

    await expect(
      telemetry.executeTelemetryComposeSmoke(allowedEnvironment(), {
        async runStep(step) {
          executed.push(step.name);
          if (step.captureStdout) return `${OLD_BACKEND_ID}\n`;
        },
        randomUUID: () => SUITE_ID,
        now: () => new Date(STARTED_AT),
      }),
    ).rejects.toThrow('Backend container generation did not change');

    expect(executed.at(-1)).toBe('telemetry-capture-backend-after');
    expect(executed).not.toContain('telemetry-recover');
    expect(executed).not.toContain('telemetry-cleanup');
  });

  it('reserves an exit code only for unsettled nested process trees', () => {
    expect(telemetry.CLEANUP_UNSAFE_EXIT_CODE).toBeGreaterThan(1);
    expect(
      telemetry.exitCodeForTelemetryComposeError(
        Object.assign(new Error('nested tree remained live'), { cleanupUnsafe: true }),
      ),
    ).toBe(telemetry.CLEANUP_UNSAFE_EXIT_CODE);
    expect(telemetry.exitCodeForTelemetryComposeError(new Error('ordinary failure'))).toBe(1);
  });

  it('states that the live projection scope is events and logs only', () => {
    expect(telemetry.TELEMETRY_DURABILITY_LIVE_COVERAGE).toEqual({
      liveProjection: ['events', 'logs'],
      readinessGate: ['events', 'logs', 'agent-trace', 'node-io'],
      staticSharedMechanismOnly: ['agent-trace', 'node-io'],
    });
    expect(telemetry.TELEMETRY_DURABILITY_COMPOSE_TIMEOUT_MS).toBe(1_920_000);
  });
});
