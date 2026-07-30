import { describe, expect, it } from 'bun:test';

interface CrashEnvironment extends NodeJS.ProcessEnv {
  SENTRIS_INSTANCE: string;
  COMPOSE_PROJECT_NAME: string;
  E2E_INTERNAL_SERVICE_TOKEN: string;
}

interface CommandCall {
  command: string;
  args: string[];
  options: { cwd: string; env: NodeJS.ProcessEnv; shell: false };
}

interface HarnessModule {
  resolveCrashRecoveryEnvironment(env: NodeJS.ProcessEnv): CrashEnvironment;
  runWorkerCrashRecoverySmoke(
    env: NodeJS.ProcessEnv,
    dependencies: {
      execFile(
        command: string,
        args: string[],
        options: { cwd: string; env: NodeJS.ProcessEnv; shell: false },
      ): Promise<{ stdout: string; stderr: string }>;
      fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
      sleep(milliseconds: number): Promise<void>;
      log(message: string): void;
      error(message: string): void;
    },
  ): Promise<void>;
}

const harness = (() => {
  try {
    return require('../worker-crash-recovery-smoke.js') as HarnessModule;
  } catch {
    return undefined;
  }
})();

function requireHarness(): HarnessModule {
  expect(harness).toBeDefined();
  return harness!;
}

function baseEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SENTRIS_INSTANCE: '7',
    SENTRIS_ALLOW_WORKER_CRASH_RECOVERY_SMOKE: 'true',
    COMPOSE_PROJECT_NAME: 'sentris-production-smoke-7',
    E2E_INTERNAL_SERVICE_TOKEN: 'crash-smoke-token',
    E2E_API_BASE_URL: 'http://127.0.0.1:8088/api/v1',
    SENTRIS_DEPLOYMENT_ID: 'sentris-production-smoke',
    SENTRIS_WORKER_CRASH_WAIT_SECONDS: '2',
    SENTRIS_WORKER_CRASH_POLL_INTERVAL_MS: '250',
    ...overrides,
  };
}

function makeScenario(
  options: {
    disappearAfterRestart?: boolean;
    disappearVolumeAfterRestart?: boolean;
    foreignReplacementScope?: boolean;
    includeRunVolume?: boolean;
    leaveDirectoryWithoutMetadataAfterTerminal?: boolean;
    leaveResourcesAfterTerminal?: boolean;
    leaveRetriedDirectoryWithoutMetadataAfterTerminal?: boolean;
    omitReplacementAttempt?: boolean;
  } = {},
) {
  const calls: CommandCall[] = [];
  const events: string[] = [];
  const requests: Array<{ url: string; method: string; headers: Headers; body?: unknown }> = [];
  let inventoryRound = 0;
  let cancelled = false;

  const metadata = (resourceId: string) =>
    JSON.stringify({
      managed: true,
      kind: 'component-io',
      resourceId,
      runId: 'run-1',
      deploymentId: 'sentris-production-smoke',
      instanceId: '7',
      temporalNamespace: 'sentris-prod',
      temporalTaskQueue: 'sentris-prod',
      createdAt: '2026-07-29T12:00:00.000Z',
    });

  const dependencies = {
    async execFile(
      command: string,
      args: string[],
      commandOptions: { cwd: string; env: NodeJS.ProcessEnv; shell: false },
    ) {
      calls.push({ command, args: [...args], options: commandOptions });
      const composeArgs = args.slice(3);

      if (
        composeArgs[0] === 'exec' &&
        composeArgs[2] === 'worker' &&
        composeArgs[3] === 'printenv'
      ) {
        events.push('reconciliation-config');
        return { stdout: '0\n1000\n', stderr: '' };
      }
      if (composeArgs[0] === 'kill') {
        events.push('worker-killed');
        return { stdout: '', stderr: '' };
      }
      if (composeArgs[0] === 'up') {
        events.push('worker-restarted-ready');
        return { stdout: '', stderr: '' };
      }
      if (
        composeArgs[0] === 'exec' &&
        composeArgs[2] === 'dind' &&
        composeArgs[3] === 'docker' &&
        composeArgs[4] === 'ps'
      ) {
        inventoryRound += 1;
        events.push(`inventory-${inventoryRound}`);
        const resourcesReady = inventoryRound >= 2;
        const afterRestart = inventoryRound >= 4;
        const afterTerminal = cancelled && inventoryRound >= 5;
        const containerIds: string[] = [];
        if (resourcesReady && !afterTerminal) {
          if (!(afterRestart && options.disappearAfterRestart)) {
            containerIds.push('container-a');
          }
          if (afterRestart && !options.omitReplacementAttempt) {
            containerIds.push('container-b');
          }
        }
        if (afterTerminal && options.leaveResourcesAfterTerminal) {
          containerIds.push('container-a');
        }
        return {
          stdout: containerIds.length > 0 ? `${containerIds.join('\n')}\n` : '',
          stderr: '',
        };
      }
      if (
        composeArgs[0] === 'exec' &&
        composeArgs[2] === 'dind' &&
        composeArgs[3] === 'docker' &&
        composeArgs[4] === 'inspect'
      ) {
        const containerIds = composeArgs.slice(5);
        return {
          stdout: JSON.stringify(
            containerIds.map((id) => ({
              Id: id,
              Config: {
                Labels: {
                  'sentris.managed': 'true',
                  'sentris.runId': 'run-1',
                  'sentris.deploymentId':
                    id === 'container-b' && options.foreignReplacementScope
                      ? 'foreign-deployment'
                      : 'sentris-production-smoke',
                  'sentris.instance': '7',
                  'sentris.temporalNamespace': 'sentris-prod',
                  'sentris.temporalTaskQueue': 'sentris-prod',
                  'sentris.ioResource': id === 'container-b' ? 'exchange-b' : 'exchange-a',
                },
              },
            })),
          ),
          stderr: '',
        };
      }
      if (
        composeArgs[0] === 'exec' &&
        composeArgs[2] === 'dind' &&
        composeArgs[3] === 'docker' &&
        composeArgs[4] === 'volume'
      ) {
        const resourcesReady = inventoryRound >= 2;
        const afterRestart = inventoryRound >= 4;
        const afterTerminal = cancelled && inventoryRound >= 5;
        const shouldExist =
          (options.includeRunVolume === true &&
            resourcesReady &&
            !(afterRestart && options.disappearVolumeAfterRestart) &&
            !afterTerminal) ||
          (afterTerminal && options.leaveResourcesAfterTerminal);
        return {
          stdout: shouldExist ? 'volume-a\n' : '',
          stderr: '',
        };
      }
      if (composeArgs[0] === 'exec' && composeArgs[2] === 'dind' && composeArgs[3] === 'find') {
        const resourcesReady = inventoryRound >= 2;
        const afterRestart = inventoryRound >= 4;
        const afterTerminal = cancelled && inventoryRound >= 5;
        const root = composeArgs[4];
        const directoryWithoutMetadata =
          afterTerminal &&
          options.leaveDirectoryWithoutMetadataAfterTerminal &&
          root === '/sentris-docker-io/runs';
        const retryResourceBeforeTerminal =
          afterRestart && !afterTerminal && !options.omitReplacementAttempt;
        const retryDirectoryAfterTerminal =
          afterTerminal &&
          options.leaveRetriedDirectoryWithoutMetadataAfterTerminal &&
          root === '/sentris-docker-io/runs';
        const resourcePaths: string[] = [];
        if (resourcesReady && !(afterRestart && options.disappearAfterRestart) && !afterTerminal) {
          resourcePaths.push(
            root === '/sentris-docker-io/runs'
              ? '/sentris-docker-io/runs/exchange-a'
              : '/sentris-docker-io/metadata/exchange-a.json',
          );
        }
        if (afterTerminal && options.leaveResourcesAfterTerminal) {
          resourcePaths.push(
            root === '/sentris-docker-io/runs'
              ? '/sentris-docker-io/runs/exchange-a'
              : '/sentris-docker-io/metadata/exchange-a.json',
          );
        }
        if (retryResourceBeforeTerminal) {
          if (root === '/sentris-docker-io/runs') {
            resourcePaths.push('/sentris-docker-io/runs/exchange-b');
          } else if (!options.leaveRetriedDirectoryWithoutMetadataAfterTerminal) {
            resourcePaths.push('/sentris-docker-io/metadata/exchange-b.json');
          }
        }
        if (directoryWithoutMetadata) {
          resourcePaths.push('/sentris-docker-io/runs/exchange-a');
        }
        if (retryDirectoryAfterTerminal) {
          resourcePaths.push('/sentris-docker-io/runs/exchange-b');
        }
        return {
          stdout: resourcePaths.length > 0 ? `${resourcePaths.join('\n')}\n` : '',
          stderr: '',
        };
      }
      if (composeArgs[0] === 'exec' && composeArgs[2] === 'dind' && composeArgs[3] === 'cat') {
        const resourceId = composeArgs[4].endsWith('/exchange-b.json')
          ? 'exchange-b'
          : 'exchange-a';
        return { stdout: metadata(resourceId), stderr: '' };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    },
    async fetch(input: string | URL | Request, init: RequestInit = {}) {
      const url = String(input);
      const method = init.method ?? 'GET';
      const headers = new Headers(init.headers);
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ url, method, headers, body });

      if (url.endsWith('/workflows') && method === 'POST') {
        events.push('workflow-created');
        return Response.json({ id: 'workflow-1' }, { status: 201 });
      }
      if (url.endsWith('/workflows/workflow-1/run') && method === 'POST') {
        events.push('run-started');
        return Response.json({ runId: 'run-1' }, { status: 201 });
      }
      if (url.endsWith('/workflows/runs/run-1/cancel') && method === 'POST') {
        events.push('run-cancelled');
        cancelled = true;
        return Response.json({ status: 'cancelled', runId: 'run-1' });
      }
      if (url.endsWith('/workflows/runs/run-1/status') && method === 'GET') {
        events.push(cancelled ? 'run-terminal' : 'run-active');
        return Response.json({ status: cancelled ? 'CANCELLED' : 'RUNNING' });
      }
      if (url.endsWith('/workflows/workflow-1') && method === 'DELETE') {
        events.push('workflow-deleted');
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
    async sleep(_milliseconds: number) {},
    log(_message: string) {},
    error(_message: string) {},
  };

  return { calls, dependencies, events, requests };
}

describe('production worker crash/reconciliation smoke', () => {
  it('requires an explicit instance, destructive opt-in, project, and internal identity', () => {
    const module = requireHarness();

    expect(() =>
      module.resolveCrashRecoveryEnvironment({
        SENTRIS_ALLOW_WORKER_CRASH_RECOVERY_SMOKE: 'true',
      }),
    ).toThrow('SENTRIS_INSTANCE must be set explicitly');
    expect(() =>
      module.resolveCrashRecoveryEnvironment({
        ...baseEnvironment(),
        SENTRIS_INSTANCE: '-1',
      }),
    ).toThrow('SENTRIS_INSTANCE must be a non-negative integer');
    expect(() =>
      module.resolveCrashRecoveryEnvironment({
        ...baseEnvironment(),
        SENTRIS_ALLOW_WORKER_CRASH_RECOVERY_SMOKE: undefined,
      }),
    ).toThrow('Worker crash/recovery smoke is destructive');
    expect(() =>
      module.resolveCrashRecoveryEnvironment({
        ...baseEnvironment(),
        COMPOSE_PROJECT_NAME: undefined,
      }),
    ).toThrow('COMPOSE_PROJECT_NAME must name the disposable production Compose project');
    expect(() =>
      module.resolveCrashRecoveryEnvironment({
        ...baseEnvironment(),
        E2E_INTERNAL_SERVICE_TOKEN: undefined,
      }),
    ).toThrow('E2E_INTERNAL_SERVICE_TOKEN or INTERNAL_SERVICE_TOKEN must be set');
  });

  it('uses the purpose-built long-running Docker workflow and internal E2E identity', async () => {
    const module = requireHarness();
    const scenario = makeScenario();

    await module.runWorkerCrashRecoverySmoke(baseEnvironment(), scenario.dependencies);

    const create = scenario.requests.find(
      (request) => request.method === 'POST' && request.url.endsWith('/workflows'),
    );
    expect(create?.headers.get('x-internal-token')).toBe('crash-smoke-token');
    expect(create?.body).toMatchObject({
      description: 'Production worker hard-crash and orphan reconciliation proof',
      nodes: [
        { id: 'start', type: 'core.workflow.entrypoint' },
        {
          id: 'crash-probe',
          type: 'sentris.security.terminal-demo',
          data: {
            config: {
              params: {
                durationSeconds: 300,
                message: 'Sentris production worker crash/recovery probe',
              },
            },
          },
        },
      ],
      edges: [{ source: 'start', target: 'crash-probe' }],
    });
  });

  it('hard-kills only after resources exist, preserves exact active resources through startup reconciliation, then proves cleanup', async () => {
    const module = requireHarness();
    const scenario = makeScenario();

    await module.runWorkerCrashRecoverySmoke(baseEnvironment(), scenario.dependencies);

    expect(scenario.events).toEqual([
      'reconciliation-config',
      'workflow-created',
      'run-started',
      'inventory-1',
      'inventory-2',
      'worker-killed',
      'inventory-3',
      'worker-restarted-ready',
      'run-active',
      'inventory-4',
      'run-cancelled',
      'run-terminal',
      'inventory-5',
      'workflow-deleted',
    ]);

    const kill = scenario.calls.find((call) => call.args.includes('kill'));
    expect(kill).toMatchObject({
      command: 'docker',
      args: ['compose', '-f', 'docker/docker-compose.full.yml', 'kill', '-s', 'SIGKILL', 'worker'],
    });
    const restart = scenario.calls.find((call) => call.args.includes('up'));
    expect(restart?.args).toEqual([
      'compose',
      '-f',
      'docker/docker-compose.full.yml',
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '2',
      'worker',
    ]);

    const containerInventory = scenario.calls.find(
      (call) => call.args.includes('ps') && call.args.includes('-aq'),
    );
    expect(containerInventory?.args).toEqual(
      expect.arrayContaining([
        'label=sentris.managed=true',
        'label=sentris.runId=run-1',
        'label=sentris.deploymentId=sentris-production-smoke',
        'label=sentris.instance=7',
        'label=sentris.temporalNamespace=sentris-prod',
        'label=sentris.temporalTaskQueue=sentris-prod',
      ]),
    );
    expect(scenario.calls.every((call) => call.options.shell === false)).toBe(true);
    expect(
      scenario.calls.every((call) => !call.args.includes('sh') && !call.args.includes('-ec')),
    ).toBe(true);
  });

  it('fails when startup reconciliation removes a resource belonging to the active run', async () => {
    const module = requireHarness();
    const scenario = makeScenario({ disappearAfterRestart: true });

    await expect(
      module.runWorkerCrashRecoverySmoke(baseEnvironment(), scenario.dependencies),
    ).rejects.toThrow('Active run resources disappeared during worker startup reconciliation');
  });

  it('fails when startup reconciliation removes an active run volume', async () => {
    const module = requireHarness();
    const scenario = makeScenario({
      includeRunVolume: true,
      disappearVolumeAfterRestart: true,
    });

    await expect(
      module.runWorkerCrashRecoverySmoke(baseEnvironment(), scenario.dependencies),
    ).rejects.toThrow(
      /Active run resources disappeared during worker startup reconciliation.*volume-a/,
    );
  });

  it('fails when the replacement worker never creates a retry attempt', async () => {
    const module = requireHarness();
    const scenario = makeScenario({ omitReplacementAttempt: true });

    await expect(
      module.runWorkerCrashRecoverySmoke(
        baseEnvironment({
          SENTRIS_WORKER_CRASH_WAIT_SECONDS: '1',
          SENTRIS_WORKER_CRASH_POLL_INTERVAL_MS: '500',
        }),
        scenario.dependencies,
      ),
    ).rejects.toThrow('Replacement worker did not create a retry attempt');
  });

  it('rejects a replacement container outside the exact run resource scope', async () => {
    const module = requireHarness();
    const scenario = makeScenario({ foreignReplacementScope: true });

    await expect(
      module.runWorkerCrashRecoverySmoke(baseEnvironment(), scenario.dependencies),
    ).rejects.toThrow('does not match the exact run scope');
  });

  it('fails closed when terminal-run containers, volumes, or exchange metadata remain', async () => {
    const module = requireHarness();
    const scenario = makeScenario({ leaveResourcesAfterTerminal: true });

    await expect(
      module.runWorkerCrashRecoverySmoke(
        baseEnvironment({
          SENTRIS_WORKER_CRASH_WAIT_SECONDS: '1',
          SENTRIS_WORKER_CRASH_POLL_INTERVAL_MS: '500',
        }),
        scenario.dependencies,
      ),
    ).rejects.toThrow(
      /Run-scoped resources remained after terminalization.*container-a.*volume-a.*exchange-a/,
    );
  });

  it('tracks the exact exchange directory even if its ownership metadata disappears first', async () => {
    const module = requireHarness();
    const scenario = makeScenario({
      leaveDirectoryWithoutMetadataAfterTerminal: true,
    });

    await expect(
      module.runWorkerCrashRecoverySmoke(
        baseEnvironment({
          SENTRIS_WORKER_CRASH_WAIT_SECONDS: '1',
          SENTRIS_WORKER_CRASH_POLL_INTERVAL_MS: '500',
        }),
        scenario.dependencies,
      ),
    ).rejects.toThrow(
      /Run-scoped resources remained after terminalization.*exchangeDirectories.*exchange-a/,
    );
  });

  it('tracks a retry-created exchange directory after its ownership metadata disappears', async () => {
    const module = requireHarness();
    const scenario = makeScenario({
      leaveRetriedDirectoryWithoutMetadataAfterTerminal: true,
    });

    await expect(
      module.runWorkerCrashRecoverySmoke(
        baseEnvironment({
          SENTRIS_WORKER_CRASH_WAIT_SECONDS: '1',
          SENTRIS_WORKER_CRASH_POLL_INTERVAL_MS: '500',
        }),
        scenario.dependencies,
      ),
    ).rejects.toThrow(
      /Run-scoped resources remained after terminalization.*exchangeDirectories.*exchange-b/,
    );
  });
});
