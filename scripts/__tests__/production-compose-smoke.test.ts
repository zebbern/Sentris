import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const smoke = require('../production-compose-smoke.js') as {
  CLEANUP_UNSAFE_EXIT_CODE: number;
  assertTelemetryProductionPreconditions(
    env: NodeJS.ProcessEnv,
    trustProfile: 'trusted-local' | 'hardened',
  ): void;
  resolveSmokeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  buildSmokeCommands(
    waitTimeoutSeconds?: number,
    trustProfile?: 'trusted-local' | 'hardened',
  ): Array<{
    name: string;
    command: string;
    args: string[];
    timeoutMs: number;
    captureStdout?: boolean;
    maxOutputBytes?: number;
  }>;
  calculateSmokeWorstCaseSeconds(
    waitTimeoutSeconds?: number,
    trustProfile?: 'trusted-local' | 'hardened',
  ): number;
  executeSmokeCommandPlan(
    commands: Array<{ name: string; command: string; args: string[]; timeoutMs: number }>,
    env: NodeJS.ProcessEnv,
    dependencies: {
      runStep(
        step: { name: string; command: string; args: string[]; timeoutMs: number },
        env: NodeJS.ProcessEnv,
      ): void;
      probeNginx(url: string): Promise<void>;
    },
  ): Promise<void>;
  runCommand(
    step: {
      name: string;
      command: string;
      args: string[];
      timeoutMs: number;
      cwd?: string;
      captureStdout?: boolean;
      maxOutputBytes?: number;
    },
    env: NodeJS.ProcessEnv,
    dependencies: {
      spawnImpl(
        command: string,
        args: string[],
        options: {
          cwd: string;
          env: NodeJS.ProcessEnv;
          shell: boolean;
        },
      ): EventEmitter & { pid: number; stdout?: PassThrough };
      schedule(callback: () => void, delayMs: number): unknown;
      cancel(handle: unknown): void;
      signalProcessTree(
        child: EventEmitter & { pid: number },
        signal: NodeJS.Signals,
      ): void | Promise<void>;
    },
  ): Promise<void | string>;
  terminateProcessTree(
    child: EventEmitter & { pid: number; kill(signal: NodeJS.Signals): void },
    signal: NodeJS.Signals,
    dependencies: {
      platform: NodeJS.Platform;
      spawnImpl(command: string, args: string[]): EventEmitter & { unref(): void };
      schedule(callback: () => void, delayMs: number): unknown;
      cancel(handle: unknown): void;
    },
  ): Promise<void>;
};

describe('production Compose smoke runner', () => {
  it('requires an explicit SENTRIS_INSTANCE in the repository-supported 0-9 range', () => {
    expect(() => smoke.resolveSmokeEnvironment({})).toThrow(
      'SENTRIS_INSTANCE must be set explicitly',
    );
    expect(() => smoke.resolveSmokeEnvironment({ SENTRIS_INSTANCE: '-1' })).toThrow(
      'SENTRIS_INSTANCE must be an integer from 0 to 9',
    );
    expect(() => smoke.resolveSmokeEnvironment({ SENTRIS_INSTANCE: '10' })).toThrow(
      'SENTRIS_INSTANCE must be an integer from 0 to 9',
    );
  });

  it('uses the E2E internal token override and provides all fail-closed Compose inputs', () => {
    const env = smoke.resolveSmokeEnvironment({
      SENTRIS_INSTANCE: '7',
      E2E_INTERNAL_SERVICE_TOKEN: 'e2e-token',
      INTERNAL_SERVICE_TOKEN: 'fallback-token',
      SENTRIS_SMOKE_NGINX_URL: 'http://127.0.0.1:8088',
      SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: 'true',
    });

    expect(env.SENTRIS_INSTANCE).toBe('7');
    expect(env.INTERNAL_SERVICE_TOKEN).toBe('e2e-token');
    expect(env.E2E_INTERNAL_SERVICE_TOKEN).toBe('e2e-token');
    expect(env.SENTRIS_PUBLIC_API_BASE_URL).toBe('http://127.0.0.1:8088');
    expect(env.E2E_API_BASE_URL).toBe('http://127.0.0.1:8088/api/v1');
    expect(env.ADMIN_USERNAME).toBeTruthy();
    expect(env.ADMIN_PASSWORD).toBeTruthy();
    expect(env.SESSION_SECRET).toBeTruthy();
    expect(env.SECRET_STORE_MASTER_KEY).toHaveLength(32);
    expect(env.MCP_DOCKER_PROXY_TOKEN).toBeTruthy();
    expect(env.WORKER_ORPHAN_MIN_AGE_MS).toBe('0');
    expect(env.WORKER_ORPHAN_INTERVAL_MS).toBe('1000');
    expect(env.LIFECYCLE_DURABILITY_SMOKE_DATABASE_NAME).toBe('sentris_lifecycle_smoke_i7');
    expect(env.LIFECYCLE_DURABILITY_SMOKE_DATABASE_URL).toEndWith('/sentris_lifecycle_smoke_i7');
    expect(env.SENTRIS_FINDINGS_OPENSEARCH_DISPOSABLE_PROJECT).toBe('true');
    expect(env.SENTRIS_ALLOW_FINDINGS_OPENSEARCH_SMOKE).toBeUndefined();
    expect(env.SENTRIS_FINDINGS_OPENSEARCH_RELEASE_MODE).toBe('true');
    expect(env.FINDINGS_OPENSEARCH_SMOKE_API_BASE_URL).toBe('http://localhost:3211/api/v1');
    expect(env.FINDINGS_OPENSEARCH_SMOKE_INTERNAL_TOKEN).toBe('e2e-token');
    expect(env.FINDINGS_OPENSEARCH_SMOKE_OPENSEARCH_URL).toBe('http://opensearch:9200');
    expect(env.FINDINGS_OPENSEARCH_SMOKE_DATABASE_URL).toBe(
      'postgresql://sentris:sentris@postgres:5432/sentris',
    );
    expect(env.FINDINGS_OPENSEARCH_SMOKE_PIT_HOLD_MS).toBe('125000');
    expect(env.FINDINGS_RECONCILIATION_SCHEDULE_ENABLED).toBe('false');
    expect(env.COMPOSE_PROJECT_NAME).toBe('sentris-production-smoke-7');
  });

  it('propagates the parent destructive approval to trusted-local child harnesses', () => {
    const env = smoke.resolveSmokeEnvironment({
      SENTRIS_INSTANCE: '7',
      SENTRIS_ALLOW_PRODUCTION_COMPOSE_SMOKE: 'true',
      SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: 'true',
    });

    expect(env.SENTRIS_ALLOW_FINDINGS_OPENSEARCH_SMOKE).toBe('true');
    expect(env.SENTRIS_ALLOW_PRODUCTION_BROWSER_JOURNEY).toBe('true');
  });

  it('builds a self-contained hardened smoke profile without enabling trusted-local stdio', () => {
    const env = smoke.resolveSmokeEnvironment({
      SENTRIS_INSTANCE: '8',
      SENTRIS_TRUST_PROFILE: 'hardened',
    });

    expect(env.SENTRIS_TRUST_PROFILE).toBe('hardened');
    expect(env.AUTH_PROVIDER).toBe('clerk');
    expect(env.VITE_AUTH_PROVIDER).toBe('clerk');
    expect(env.CLERK_SECRET_KEY).toMatch(/^sk_test_/);
    expect(env.CLERK_PUBLISHABLE_KEY).toMatch(/^pk_test_/);
    expect(env.VITE_CLERK_PUBLISHABLE_KEY).toBe(env.CLERK_PUBLISHABLE_KEY);
    expect(env.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO).toBe('false');
    expect(env.FINDINGS_RECONCILIATION_SCHEDULE_ENABLED).toBe('true');
  });

  it('passes the validated findings scheduler switch only to the backend container', () => {
    const compose = readFileSync(
      join(import.meta.dir, '..', '..', 'docker', 'docker-compose.full.yml'),
      'utf8',
    );

    expect(compose).toContain(
      'FINDINGS_RECONCILIATION_SCHEDULE_ENABLED=${FINDINGS_RECONCILIATION_SCHEDULE_ENABLED:-true}',
    );
    expect(compose.match(/FINDINGS_RECONCILIATION_SCHEDULE_ENABLED=/g)).toHaveLength(1);
    expect(compose).toContain(
      'OPENSEARCH_TENANT_FETCH_TIMEOUT_MS=${OPENSEARCH_TENANT_FETCH_TIMEOUT_MS:-5000}',
    );
  });

  it("pins the DinD server certificate SAN to the worker's Compose service hostname", () => {
    const compose = readFileSync(
      join(import.meta.dir, '..', '..', 'docker', 'docker-compose.full.yml'),
      'utf8',
    );
    const dind = compose.slice(compose.indexOf('\n  dind:'), compose.indexOf('\n  backend:'));
    const worker = compose.slice(compose.indexOf('\n  worker:'), compose.indexOf('\n  nginx:'));

    expect(dind).toContain('DOCKER_TLS_CERTDIR=/certs');
    expect(dind).toContain('DOCKER_TLS_SAN=DNS:dind');
    expect(worker).toContain('DOCKER_HOST=tcp://dind:2376');
    expect(worker).toContain('DOCKER_TLS_VERIFY=1');
  });

  it('rejects an unknown trust profile instead of silently weakening the smoke', () => {
    expect(() =>
      smoke.resolveSmokeEnvironment({
        SENTRIS_INSTANCE: '8',
        SENTRIS_TRUST_PROFILE: 'permissive',
      }),
    ).toThrow('SENTRIS_TRUST_PROFILE must be trusted-local or hardened');
  });

  it('rejects retained or project-drifted trusted-local telemetry stacks', () => {
    expect(() =>
      smoke.resolveSmokeEnvironment({
        SENTRIS_INSTANCE: '8',
        SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: 'true',
        SENTRIS_PRODUCTION_SMOKE_KEEP: 'true',
      }),
    ).toThrow('SENTRIS_PRODUCTION_SMOKE_KEEP=true');
    expect(() =>
      smoke.assertTelemetryProductionPreconditions(
        {
          SENTRIS_INSTANCE: '8',
          SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: 'true',
          COMPOSE_PROJECT_NAME: 'sentris-production-smoke-other',
        },
        'trusted-local',
      ),
    ).toThrow('COMPOSE_PROJECT_NAME must be sentris-production-smoke-8');
  });

  it('fails before Compose unless trusted-local telemetry destruction is explicit', () => {
    expect(() =>
      smoke.assertTelemetryProductionPreconditions(
        {
          CI: 'true',
          SENTRIS_INSTANCE: '8',
          COMPOSE_PROJECT_NAME: 'sentris-production-smoke-8',
        },
        'trusted-local',
      ),
    ).toThrow('requires SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT=true');
    expect(() =>
      smoke.assertTelemetryProductionPreconditions(
        {
          CI: 'true',
          SENTRIS_INSTANCE: '8',
          COMPOSE_PROJECT_NAME: 'sentris-production-smoke-8',
          SENTRIS_TELEMETRY_DURABILITY_DISPOSABLE_PROJECT: 'true',
        },
        'trusted-local',
      ),
    ).not.toThrow();
    expect(() =>
      smoke.assertTelemetryProductionPreconditions(
        {
          CI: 'true',
          SENTRIS_INSTANCE: '8',
        },
        'hardened',
      ),
    ).not.toThrow();
  });

  it('starts from scratch, probes services, verifies run cleanup, then removes volumes', () => {
    const commands = smoke.buildSmokeCommands(420);
    const rendered = commands.map(({ command, args }) => `${command} ${args.join(' ')}`);
    const names = commands.map((command) => command.name);

    expect(rendered).toEqual(
      expect.arrayContaining([
        expect.stringContaining('compose -f docker/docker-compose.full.yml config --quiet'),
        expect.stringContaining('compose -f docker/docker-compose.full.yml build'),
        expect.stringContaining(
          'compose -f docker/docker-compose.full.yml up -d --wait --wait-timeout 420',
        ),
        expect.stringContaining(
          'compose -f docker/docker-compose.full.yml run --rm --no-deps opensearch-init',
        ),
        expect.stringContaining('exec -T backend curl -sf http://localhost:3211/health/ready'),
        expect.stringContaining('exec -T worker curl -sf http://localhost:9100/health/ready'),
        expect.stringContaining(
          'tctl --address temporal:7233 --namespace sentris-prod namespace describe',
        ),
        expect.stringContaining('exec -T dind docker info'),
        'bun run smoke:worker-crash-recovery',
        'bun run test:e2e:release',
        'bun run smoke:browser-target-journey',
        expect.stringContaining('label=sentris.managed=true'),
        expect.stringContaining('/sentris-docker-io/runs'),
        expect.stringContaining('/sentris-docker-io/metadata'),
        expect.stringContaining('down -v --remove-orphans'),
      ]),
    );
    expect(names.slice(0, 9)).toEqual([
      'config',
      'build',
      'up',
      'opensearch-init',
      'temporal-namespace',
      'backend-readiness',
      'worker-readiness',
      'dind-readiness',
      'mcp-proxy-auth',
    ]);
    expect(names.indexOf('worker-crash-recovery')).toBeLessThan(names.indexOf('critical-journey'));
    expect(names.slice(-5)).toEqual([
      'critical-journey',
      'browser-target-journey',
      'managed-resource-cleanup',
      'telemetry-durability',
      'down',
    ]);
    expect(rendered.at(-2)).toBe('node scripts/telemetry-durability-compose-smoke.js');
    expect(commands.every((command) => Number.isInteger(command.timeoutMs))).toBe(true);
    expect(commands.every((command) => command.timeoutMs > 0)).toBe(true);
  });

  it('gives a slow image build and the full service-readiness window independent hard bounds', () => {
    const waitTimeoutSeconds = 300;
    const observedImageBuildMs = 185_000;
    const fullReadinessWindowMs = waitTimeoutSeconds * 1_000;
    const commands = smoke.buildSmokeCommands(waitTimeoutSeconds, 'trusted-local');
    const build = commands.find((command) => command.name === 'build');
    const up = commands.find((command) => command.name === 'up');

    expect(build?.args).toEqual(['compose', '-f', 'docker/docker-compose.full.yml', 'build']);
    expect(build?.timeoutMs).toBe(waitTimeoutSeconds * 1_000);
    expect(up?.args).not.toContain('--build');
    expect(up?.timeoutMs).toBe((waitTimeoutSeconds + 60) * 1_000);
    expect(observedImageBuildMs).toBeLessThan(build!.timeoutMs);
    expect(fullReadinessWindowMs).toBeLessThan(up!.timeoutMs);
    expect(observedImageBuildMs + fullReadinessWindowMs).toBeGreaterThan(up!.timeoutMs);
  });

  it('waits only on long-running services and fails closed when the one-shot initializer fails', async () => {
    const commands = smoke.buildSmokeCommands(120, 'trusted-local');
    const up = commands.find((command) => command.name === 'up');
    const initializer = commands.find((command) => command.name === 'opensearch-init');
    const executed: string[] = [];
    let nginxProbed = false;

    expect(up?.args).toEqual([
      'compose',
      '-f',
      'docker/docker-compose.full.yml',
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '120',
      '--scale',
      'opensearch-init=0',
    ]);
    expect(initializer?.args).toEqual([
      'compose',
      '-f',
      'docker/docker-compose.full.yml',
      'run',
      '--rm',
      '--no-deps',
      'opensearch-init',
    ]);
    expect(commands.indexOf(initializer!)).toBe(commands.indexOf(up!) + 1);

    await expect(
      smoke.executeSmokeCommandPlan(
        commands,
        {
          SENTRIS_SMOKE_NGINX_URL: 'http://127.0.0.1',
        },
        {
          runStep(step) {
            executed.push(step.name);
            if (step.name === 'opensearch-init') {
              throw new Error('injected initializer failure');
            }
          },
          async probeNginx() {
            nginxProbed = true;
          },
        },
      ),
    ).rejects.toThrow('injected initializer failure');

    expect(executed).toEqual(['config', 'build', 'up', 'opensearch-init', 'down']);
    expect(nginxProbed).toBe(false);
  });

  it('exposes a truthful trusted-local bound below the required future 180-minute CI budget', () => {
    const requiredJobTimeoutMinutes = 180;
    const runnerWorstCaseSeconds = smoke.calculateSmokeWorstCaseSeconds(300, 'trusted-local');
    const hardenedWorstCaseSeconds = smoke.calculateSmokeWorstCaseSeconds(300, 'hardened');

    expect(runnerWorstCaseSeconds).toBe(10_420);
    expect(hardenedWorstCaseSeconds).toBe(5_800);
    expect(runnerWorstCaseSeconds).toBeGreaterThan(150 * 60);
    expect(runnerWorstCaseSeconds).toBeLessThan(175 * 60);
    expect(runnerWorstCaseSeconds).toBeLessThan(requiredJobTimeoutMinutes * 60);
  });

  it('drops the lifecycle database and Compose volumes when the harness child fails', async () => {
    const commands = smoke.buildSmokeCommands(120, 'trusted-local');
    const executed: string[] = [];

    await expect(
      smoke.executeSmokeCommandPlan(
        commands,
        {
          SENTRIS_SMOKE_NGINX_URL: 'http://127.0.0.1',
        },
        {
          runStep(step) {
            executed.push(step.name);
            if (step.name === 'lifecycle-durability') {
              throw new Error('injected lifecycle child timeout');
            }
          },
          async probeNginx() {},
        },
      ),
    ).rejects.toThrow('injected lifecycle child timeout');

    expect(executed.filter((name) => name === 'lifecycle-db-drop')).toEqual(['lifecycle-db-drop']);
    expect(executed.at(-1)).toBe('down');
    expect(executed).not.toContain('critical-journey');
  });

  it('runs only the outer final down after an ordinary telemetry wrapper failure', async () => {
    const commands = smoke.buildSmokeCommands(120, 'trusted-local');
    const executed: string[] = [];

    await expect(
      smoke.executeSmokeCommandPlan(
        commands,
        {
          SENTRIS_SMOKE_NGINX_URL: 'http://127.0.0.1',
        },
        {
          runStep(step) {
            executed.push(step.name);
            if (step.name === 'telemetry-durability') {
              throw new Error('injected telemetry phase failure');
            }
          },
          async probeNginx() {},
        },
      ),
    ).rejects.toThrow('injected telemetry phase failure');

    expect(executed.slice(-2)).toEqual(['telemetry-durability', 'down']);
    expect(executed.filter((name) => name === 'down')).toHaveLength(1);
  });

  it('removes partially created Compose resources when the up command itself fails', async () => {
    const commands = smoke.buildSmokeCommands(120, 'trusted-local');
    const executed: string[] = [];

    await expect(
      smoke.executeSmokeCommandPlan(
        commands,
        {
          SENTRIS_SMOKE_NGINX_URL: 'http://127.0.0.1',
        },
        {
          runStep(step) {
            executed.push(step.name);
            if (step.name === 'up') throw new Error('injected partial Compose up');
          },
          async probeNginx() {},
        },
      ),
    ).rejects.toThrow('injected partial Compose up');

    expect(executed).toEqual(['config', 'build', 'up', 'down']);
  });

  it('suppresses follow-on cleanup when command-tree settlement cannot be proved', async () => {
    const commands = smoke.buildSmokeCommands(120, 'trusted-local');
    const executed: string[] = [];
    const unsafeError = Object.assign(new Error('tree settlement was not proved'), {
      cleanupUnsafe: true,
    });

    await expect(
      smoke.executeSmokeCommandPlan(
        commands,
        {
          SENTRIS_SMOKE_NGINX_URL: 'http://127.0.0.1',
        },
        {
          runStep(step) {
            executed.push(step.name);
            if (step.name === 'up') throw unsafeError;
          },
          async probeNginx() {},
        },
      ),
    ).rejects.toBe(unsafeError);

    expect(executed).toEqual(['config', 'build', 'up']);
  });

  it('stops later cleanup after an unsafe cleanup command', async () => {
    const commands = smoke.buildSmokeCommands(120, 'trusted-local');
    const executed: string[] = [];
    const unsafeCleanupError = Object.assign(new Error('cleanup tree remained live'), {
      cleanupUnsafe: true,
    });

    await expect(
      smoke.executeSmokeCommandPlan(
        commands,
        {
          SENTRIS_SMOKE_NGINX_URL: 'http://127.0.0.1',
        },
        {
          runStep(step) {
            executed.push(step.name);
            if (step.name === 'lifecycle-durability') {
              throw new Error('injected lifecycle failure');
            }
            if (step.name === 'lifecycle-db-drop') {
              throw unsafeCleanupError;
            }
          },
          async probeNginx() {},
        },
      ),
    ).rejects.toThrow('injected lifecycle failure');

    expect(executed.at(-1)).toBe('lifecycle-db-drop');
    expect(executed).not.toContain('down');
  });

  it('restores OpenSearch and backend readiness when the outage assertion fails and the stack is retained', async () => {
    const commands = smoke.buildSmokeCommands(120, 'trusted-local');
    const executed: string[] = [];

    await expect(
      smoke.executeSmokeCommandPlan(
        commands,
        {
          SENTRIS_SMOKE_NGINX_URL: 'http://127.0.0.1',
          SENTRIS_PRODUCTION_SMOKE_KEEP: 'true',
        },
        {
          runStep(step) {
            executed.push(step.name);
            if (step.name === 'findings-opensearch-unavailable') {
              throw new Error('injected false-empty findings response');
            }
          },
          async probeNginx() {},
        },
      ),
    ).rejects.toThrow('injected false-empty findings response');

    expect(executed.slice(-2)).toEqual([
      'findings-opensearch-restart',
      'findings-opensearch-backend-recovered',
    ]);
    expect(executed).not.toContain('down');
  });

  it('waits for KILL and child settlement before releasing a timed-out command', async () => {
    let unrefCount = 0;
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      unref() {
        unrefCount += 1;
      },
    });
    const scheduled: { callback: () => void; delayMs: number }[] = [];
    const cancelled: unknown[] = [];
    const signals: NodeJS.Signals[] = [];
    let resolveKill!: () => void;
    const killSettlement = new Promise<void>((resolve) => {
      resolveKill = resolve;
    });
    let outcome: 'resolved' | 'rejected' | undefined;
    const promise = smoke.runCommand(
      {
        name: 'bounded-child',
        command: 'synthetic-child',
        args: [],
        timeoutMs: 30_000,
      },
      {},
      {
        spawnImpl: () => child,
        schedule(callback, delayMs) {
          const handle = { callback, delayMs };
          scheduled.push(handle);
          return handle;
        },
        cancel(handle) {
          cancelled.push(handle);
        },
        signalProcessTree(target, signal) {
          expect(target).toBe(child);
          signals.push(signal);
          return signal === 'SIGKILL' ? killSettlement : Promise.resolve();
        },
      },
    );
    void promise.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );

    expect(scheduled.map(({ delayMs }) => delayMs)).toEqual([25_000, 27_000, 30_000]);
    scheduled[0]!.callback();
    expect(signals).toEqual(['SIGTERM']);
    child.emit('close', 0, null);
    await Promise.resolve();
    expect(outcome).toBeUndefined();
    scheduled[1]!.callback();
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    await Promise.resolve();
    expect(outcome).toBeUndefined();
    resolveKill();
    await expect(promise).rejects.toThrow(
      'bounded-child exceeded its 30-second hard process bound',
    );
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(cancelled).toHaveLength(3);
    expect(unrefCount).toBe(0);
  });

  it('runs a step from its explicit source root without enabling a shell', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 4242 });
    let spawnOptions:
      | {
          cwd: string;
          env: NodeJS.ProcessEnv;
          shell: boolean;
        }
      | undefined;
    const command = smoke.runCommand(
      {
        name: 'baseline-compose-up',
        command: 'docker',
        args: ['compose', 'up'],
        timeoutMs: 30_000,
        cwd: 'C:\\worktrees\\baseline',
      },
      { SENTRIS_INSTANCE: '7' },
      {
        spawnImpl(_command, _args, options) {
          spawnOptions = options;
          return child;
        },
        schedule() {
          return {};
        },
        cancel() {},
        signalProcessTree() {},
      },
    );

    child.emit('close', 0, null);
    await expect(command).resolves.toBeUndefined();
    expect(spawnOptions).toMatchObject({
      cwd: 'C:\\worktrees\\baseline',
      env: { SENTRIS_INSTANCE: '7' },
      shell: false,
    });
  });

  it('marks an unclosed command tree unsafe and unrefs it at the hard bound', async () => {
    let unrefCount = 0;
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      unref() {
        unrefCount += 1;
      },
    });
    const scheduled: { callback: () => void; delayMs: number }[] = [];
    const promise = smoke.runCommand(
      {
        name: 'unsettled-child',
        command: 'synthetic-child',
        args: [],
        timeoutMs: 30_000,
      },
      {},
      {
        spawnImpl: () => child,
        schedule(callback, delayMs) {
          const handle = { callback, delayMs };
          scheduled.push(handle);
          return handle;
        },
        cancel() {},
        signalProcessTree() {
          return Promise.resolve();
        },
      },
    );

    scheduled[0]!.callback();
    scheduled[1]!.callback();
    await Promise.resolve();
    scheduled[2]!.callback();

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('follow-on cleanup is suppressed');
    expect((error as Error & { cleanupUnsafe?: boolean }).cleanupUnsafe).toBe(true);
    expect(unrefCount).toBe(1);
  });

  it('captures bounded stdout without enabling a shell', async () => {
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { pid: 4242, stdout });
    let spawnOptions:
      | {
          stdio: ['inherit', 'pipe', 'inherit'];
          shell: boolean;
        }
      | undefined;
    const command = smoke.runCommand(
      {
        name: 'capture-backend-generation',
        command: 'docker',
        args: ['compose', 'ps', '--quiet', 'backend'],
        timeoutMs: 30_000,
        captureStdout: true,
        maxOutputBytes: 128,
      },
      {},
      {
        spawnImpl(_command, _args, options) {
          spawnOptions = options as typeof spawnOptions;
          return child;
        },
        schedule() {
          return {};
        },
        cancel() {},
        signalProcessTree() {},
      },
    );

    stdout.write(`${'a'.repeat(64)}\n`);
    child.emit('close', 0, null);

    await expect(command).resolves.toBe(`${'a'.repeat(64)}\n`);
    expect(spawnOptions).toMatchObject({
      stdio: ['inherit', 'pipe', 'inherit'],
      shell: false,
    });
  });

  it('maps the reserved nested-tree exit code to cleanup-unsafe', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 4242 });
    const command = smoke.runCommand(
      {
        name: 'telemetry-durability',
        command: 'node',
        args: ['scripts/telemetry-durability-compose-smoke.js'],
        timeoutMs: 30_000,
      },
      {},
      {
        spawnImpl: () => child,
        schedule() {
          return {};
        },
        cancel() {},
        signalProcessTree() {},
      },
    );

    child.emit('close', smoke.CLEANUP_UNSAFE_EXIT_CODE, null);
    const error = await command.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { cleanupUnsafe?: boolean }).cleanupUnsafe).toBe(true);
  });

  it('does not classify cleanup safe while the soft tree terminator is still live', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      unref() {},
    });
    const scheduled: { callback: () => void; delayMs: number }[] = [];
    const neverSettles = new Promise<void>(() => {});
    const promise = smoke.runCommand(
      {
        name: 'hung-soft-terminator',
        command: 'synthetic-child',
        args: [],
        timeoutMs: 30_000,
      },
      {},
      {
        spawnImpl: () => child,
        schedule(callback, delayMs) {
          const handle = { callback, delayMs };
          scheduled.push(handle);
          return handle;
        },
        cancel() {},
        signalProcessTree(_target, signal) {
          return signal === 'SIGTERM' ? neverSettles : Promise.resolve();
        },
      },
    );

    scheduled[0]!.callback();
    child.emit('close', 0, null);
    scheduled[1]!.callback();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    scheduled[2]!.callback();

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { cleanupUnsafe?: boolean }).cleanupUnsafe).toBe(true);
    expect((error as Error).message).toContain('follow-on cleanup is suppressed');
  });

  it('preserves child errors after TERM without cancelling tree escalation', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 4242 });
    const scheduled: { callback: () => void; delayMs: number }[] = [];
    const signals: NodeJS.Signals[] = [];
    const childError = new Error('leader failed while descendants remained');
    const result = smoke
      .runCommand(
        {
          name: 'erroring-leader',
          command: 'synthetic-child',
          args: [],
          timeoutMs: 30_000,
        },
        {},
        {
          spawnImpl: () => child,
          schedule(callback, delayMs) {
            const handle = { callback, delayMs };
            scheduled.push(handle);
            return handle;
          },
          cancel() {},
          signalProcessTree(_target, signal) {
            signals.push(signal);
          },
        },
      )
      .catch((error: unknown) => error);

    scheduled[0]!.callback();
    child.emit('error', childError);
    scheduled[1]!.callback();
    scheduled[2]!.callback();

    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'erroring-leader exceeded its 30-second hard process bound',
    );
    expect((error as Error & { cleanupUnsafe?: boolean }).cleanupUnsafe).toBe(true);
    expect((error as Error & { cause?: unknown }).cause).toBe(childError);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('waits for tree-aware Windows soft termination to settle', async () => {
    const order: string[] = [];
    const taskkill = Object.assign(new EventEmitter(), {
      unref() {
        order.push('taskkill-unref');
      },
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      kill(signal: NodeJS.Signals) {
        order.push(`direct-${signal}`);
      },
    });

    const settlement = smoke.terminateProcessTree(child, 'SIGTERM', {
      platform: 'win32',
      spawnImpl(command, args) {
        order.push(`${command} ${args.join(' ')}`);
        return taskkill;
      },
      schedule() {
        throw new Error('soft tree termination must not schedule a direct-root fallback');
      },
      cancel() {},
    });

    expect(order).toEqual(['taskkill /pid 4242 /t', 'taskkill-unref']);
    taskkill.emit('close', 0);
    await settlement;
  });

  it('rejects Windows tree settlement when taskkill needs a direct-child fallback', async () => {
    const order: string[] = [];
    const taskkill = Object.assign(new EventEmitter(), {
      unref() {
        order.push('taskkill-unref');
      },
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      kill(signal: NodeJS.Signals) {
        order.push(`direct-${signal}`);
      },
    });
    let fallback: (() => void) | undefined;

    const settlement = smoke.terminateProcessTree(child, 'SIGKILL', {
      platform: 'win32',
      spawnImpl(command, args) {
        order.push(`${command} ${args.join(' ')}`);
        return taskkill;
      },
      schedule(callback, delayMs) {
        expect(delayMs).toBeLessThan(1_000);
        fallback = callback;
        return 'fallback-timer';
      },
      cancel(handle) {
        expect(handle).toBe('fallback-timer');
      },
    });

    expect(order).toEqual(['taskkill /pid 4242 /t /f', 'taskkill-unref']);
    fallback?.();
    expect(order).toEqual(['taskkill /pid 4242 /t /f', 'taskkill-unref', 'direct-SIGKILL']);
    await expect(settlement).rejects.toThrow('could not prove Windows process-tree termination');
  });

  it('runs the real-browser journey only for trusted-local production smoke', () => {
    const trustedNames = smoke
      .buildSmokeCommands(300, 'trusted-local')
      .map((command) => command.name);
    const hardenedNames = smoke.buildSmokeCommands(300, 'hardened').map((command) => command.name);

    expect(trustedNames).toContain('browser-target-journey');
    expect(trustedNames.indexOf('browser-target-journey')).toBeGreaterThan(
      trustedNames.indexOf('critical-journey'),
    );
    expect(trustedNames.indexOf('browser-target-journey')).toBeLessThan(
      trustedNames.indexOf('managed-resource-cleanup'),
    );
    expect(trustedNames.indexOf('telemetry-durability')).toBeGreaterThan(
      trustedNames.indexOf('managed-resource-cleanup'),
    );
    expect(trustedNames.indexOf('telemetry-durability')).toBeLessThan(trustedNames.indexOf('down'));
    expect(hardenedNames).not.toContain('browser-target-journey');
    expect(hardenedNames).not.toContain('telemetry-durability');
  });

  it('proves findings fail closed during an OpenSearch outage, recovers, then runs live acceptance only for trusted-local', () => {
    const trusted = smoke.buildSmokeCommands(300, 'trusted-local');
    const trustedNames = trusted.map((command) => command.name);
    const hardenedNames = smoke.buildSmokeCommands(300, 'hardened').map((command) => command.name);
    const stop = trustedNames.indexOf('findings-opensearch-stop');
    const unavailable = trustedNames.indexOf('findings-opensearch-unavailable');
    const restart = trustedNames.indexOf('findings-opensearch-restart');
    const recovered = trustedNames.indexOf('findings-opensearch-backend-recovered');
    const acceptance = trustedNames.indexOf('findings-opensearch-acceptance');

    expect(stop).toBeGreaterThan(trustedNames.indexOf('post-fault-worker-readiness'));
    expect(unavailable).toBeGreaterThan(stop);
    expect(restart).toBeGreaterThan(unavailable);
    expect(recovered).toBeGreaterThan(restart);
    expect(acceptance).toBeGreaterThan(recovered);
    expect(acceptance).toBeLessThan(trustedNames.indexOf('lifecycle-db-reset'));
    expect(hardenedNames.some((name) => name.startsWith('findings-opensearch-'))).toBe(false);

    const rendered = trusted.map(({ command, args }) => `${command} ${args.join(' ')}`);
    expect(rendered[unavailable]).toContain('http://localhost:3211/api/v1/findings');
    expect(rendered[unavailable]).toContain('x-internal-token');
    expect(rendered[unavailable]).toContain('x-organization-id');
    expect(rendered[unavailable]).toContain('test "$status" = "503"');
    expect(rendered[restart]).toContain(
      'compose -f docker/docker-compose.full.yml up -d --wait --wait-timeout 120 opensearch',
    );
    expect(rendered[acceptance]).toContain('bun run smoke:findings-opensearch');
    expect(rendered[acceptance]).toContain('--kill-after=15');
    for (const variable of [
      'CI',
      'SENTRIS_INSTANCE',
      'COMPOSE_PROJECT_NAME',
      'SENTRIS_ALLOW_FINDINGS_OPENSEARCH_SMOKE',
      'SENTRIS_FINDINGS_OPENSEARCH_DISPOSABLE_PROJECT',
      'SENTRIS_FINDINGS_OPENSEARCH_RELEASE_MODE',
      'FINDINGS_OPENSEARCH_SMOKE_API_BASE_URL',
      'FINDINGS_OPENSEARCH_SMOKE_INTERNAL_TOKEN',
      'FINDINGS_OPENSEARCH_SMOKE_OPENSEARCH_URL',
      'FINDINGS_OPENSEARCH_SMOKE_DATABASE_URL',
      'FINDINGS_OPENSEARCH_SMOKE_PIT_HOLD_MS',
    ]) {
      expect(rendered[acceptance]).toContain(`-e ${variable}`);
    }
  });

  it('faults and recovers every dependency required by worker readiness', () => {
    const commands = smoke.buildSmokeCommands();
    const names = commands.map((command) => command.name);

    for (const dependency of [
      'temporal',
      'dind',
      'postgres',
      'minio',
      'redis',
      'redpanda',
      'backend',
    ]) {
      const stop = names.indexOf(`stop-${dependency}`);
      const failure = names.indexOf(`observe-${dependency}-readiness-failure`);
      const start = names.indexOf(`start-${dependency}`);
      const recovered = names.indexOf(`recover-${dependency}-readiness`);
      expect(stop).toBeGreaterThan(6);
      expect(failure).toBeGreaterThan(stop);
      expect(start).toBeGreaterThan(failure);
      expect(recovered).toBeGreaterThan(start);
      expect(names.indexOf('critical-journey')).toBeGreaterThan(recovered);
    }

    const rendered = commands.map(({ command, args }) => `${command} ${args.join(' ')}`);
    expect(
      rendered.some((command) => command.includes('%{http_code}') && command.includes('503')),
    ).toBe(true);
    expect(
      rendered.some(
        (command) =>
          command.includes('http://localhost:9100/health/ready') &&
          command.includes('readiness did not recover'),
      ),
    ).toBe(true);
  });

  it('keeps telemetry, cancellation, and live Docker output in the strict critical journey', () => {
    const journey = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'e2e-tests',
        'core',
        'self-hosted-critical-journey.test.ts',
      ),
      'utf8',
    );

    expect(journey).toContain('baseline telemetry ingestion');
    expect(journey).toContain('/trace');
    expect(journey).toContain("event.type === 'COMPLETED'");
    expect(journey).toContain("type: 'sentris.security.terminal-demo'");
    expect(journey).toContain('/terminal?nodeRef=');
    expect(journey).toContain('/cancel');
    expect(journey).toContain("toBe('CANCELLED')");
  });

  it('is exposed as an explicit package release smoke command', () => {
    const packageJson = JSON.parse(
      readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(packageJson.scripts['smoke:production-compose']).toBe(
      'node scripts/production-compose-smoke.js',
    );
    expect(packageJson.scripts['smoke:worker-crash-recovery']).toBe(
      'node scripts/worker-crash-recovery-smoke.js',
    );
    expect(packageJson.scripts['smoke:browser-target-journey']).toBe(
      'node scripts/browser-target-journey.js',
    );
    expect(packageJson.scripts['smoke:findings-opensearch']).toBe(
      'bun --cwd=backend run smoke:findings-opensearch',
    );
    expect(packageJson.scripts['smoke:findings-opensearch:typecheck']).toBe(
      'bun --cwd=backend run smoke:findings-opensearch:typecheck',
    );
    expect(packageJson.scripts['test:e2e:release']).toBe(
      'node scripts/e2e-test.js --require-explicit-instance --strict-services e2e-tests/core/self-hosted-critical-journey.test.ts',
    );
    expect(packageJson.devDependencies.playwright).toBeString();

    const backendPackageJson = JSON.parse(
      readFileSync(join(import.meta.dir, '..', '..', 'backend', 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(backendPackageJson.scripts['smoke:findings-opensearch']).toBe(
      'bun scripts/findings-opensearch-acceptance.ts',
    );
    expect(backendPackageJson.scripts['smoke:findings-opensearch:typecheck']).toBe(
      'tsc -p tsconfig.findings-opensearch-smoke.json',
    );
  });
});
