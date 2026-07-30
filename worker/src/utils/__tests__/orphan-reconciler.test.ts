import { describe, expect, it, vi } from 'bun:test';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  DockerCommand,
  ManagedRunResource,
  OrphanResourceClient,
  ReconciliationReport,
} from '../orphan-reconciler';
import {
  canonicalWorkflowRunId,
  createDockerOrphanResourceClient,
  createTemporalRunActivityResolver,
} from '../orphan-reconciler';
import type { DockerResourceScope } from '@sentris/component-sdk';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const OLD = new Date(NOW - 2 * 60 * 60 * 1_000);
const YOUNG = new Date(NOW - 5 * 60 * 1_000);
const ACTIVE_RUN = 'sentris-run-11111111-1111-4111-8111-111111111111';
const INACTIVE_RUN = 'sentris-run-22222222-2222-4222-8222-222222222222';
const RESOURCE_SCOPE: DockerResourceScope = {
  deploymentId: 'deployment-a',
  instanceId: '2',
  temporalNamespace: 'namespace-a',
  temporalTaskQueue: 'queue-a',
};
const SCOPE_LABELS = {
  'sentris.managed': 'true',
  'sentris.deploymentId': RESOURCE_SCOPE.deploymentId,
  'sentris.instance': RESOURCE_SCOPE.instanceId,
  'sentris.temporalNamespace': RESOURCE_SCOPE.temporalNamespace,
  'sentris.temporalTaskQueue': RESOURCE_SCOPE.temporalTaskQueue,
};

function resource(
  kind: ManagedRunResource['kind'],
  id: string,
  runId: string,
  createdAt = OLD,
): ManagedRunResource {
  return { kind, id, runId, createdAt };
}

function fakeClient(resources: ManagedRunResource[]): {
  client: OrphanResourceClient;
  removed: string[];
} {
  const removed: string[] = [];
  return {
    client: {
      listManagedResources: async () => resources,
      removeResource: async (candidate) => {
        removed.push(`${candidate.kind}:${candidate.id}`);
      },
    },
    removed,
  };
}

describe('orphan resource reconciliation', () => {
  it('removes old inactive resources while preserving active and young resources', async () => {
    const reconciler = await import('../orphan-reconciler').catch(() => undefined);
    const { client, removed } = fakeClient([
      resource('volume', 'active-suffix-volume', `${ACTIVE_RUN}-codeql-output`),
      resource('container', 'inactive-container', INACTIVE_RUN),
      resource('exchange-directory', 'inactive-exchange', INACTIVE_RUN),
      resource('container', 'active-container', ACTIVE_RUN),
      resource('volume', 'young-volume', INACTIVE_RUN, YOUNG),
    ]);

    const report = await reconciler?.reconcileOrphanedRunResources({
      client,
      isRunActive: async (runId: string) => runId === ACTIVE_RUN,
      minAgeMs: 60 * 60 * 1_000,
      maxResources: 20,
      now: () => NOW,
    });

    expect(removed).toEqual([
      'container:inactive-container',
      'exchange-directory:inactive-exchange',
    ]);
    expect(report).toMatchObject({
      examined: 5,
      preservedActive: 2,
      preservedYoung: 1,
      truncated: false,
      removed: {
        containers: 1,
        volumes: 0,
        exchangeDirectories: 1,
      },
    });
  });

  it('normalizes scanner volume suffixes before asking Temporal about active runs', async () => {
    const reconciler = await import('../orphan-reconciler').catch(() => undefined);
    const seenRunIds: string[] = [];
    const { client } = fakeClient([
      resource('volume', 'scanner-volume', `${ACTIVE_RUN}-prowler-out`),
    ]);

    await reconciler?.reconcileOrphanedRunResources({
      client,
      isRunActive: async (runId: string) => {
        seenRunIds.push(runId);
        return true;
      },
      minAgeMs: 0,
      maxResources: 20,
      now: () => NOW,
    });

    expect(seenRunIds).toEqual([ACTIVE_RUN]);
  });

  it('normalizes scanner suffixes on deterministic SHA-256 workflow IDs', () => {
    const deterministicRunId = `sentris-run-${'a'.repeat(64)}`;

    expect(canonicalWorkflowRunId(`${deterministicRunId}-prowler-out`)).toBe(deterministicRunId);
  });

  it('normalizes nested loop execution IDs to their owning Temporal workflow', () => {
    expect(canonicalWorkflowRunId(`${ACTIVE_RUN}:for-each:0`)).toBe(ACTIVE_RUN);
  });

  it('caps each pass and reports that eligible resources remain', async () => {
    const reconciler = await import('../orphan-reconciler').catch(() => undefined);
    const { client, removed } = fakeClient([
      resource('container', 'container-1', INACTIVE_RUN),
      resource('volume', 'volume-1', INACTIVE_RUN),
      resource('exchange-directory', 'exchange-1', INACTIVE_RUN),
    ]);

    const report = await reconciler?.reconcileOrphanedRunResources({
      client,
      isRunActive: async () => false,
      minAgeMs: 0,
      maxResources: 2,
      now: () => NOW,
    });

    expect(removed).toHaveLength(2);
    expect(report?.truncated).toBe(true);
    expect(report?.remainingEligible).toBe(1);
  });

  it('fails closed before deleting anything when active-run state is unknown', async () => {
    const reconciler = await import('../orphan-reconciler').catch(() => undefined);
    const { client, removed } = fakeClient([
      resource('container', 'container-1', INACTIVE_RUN),
      resource('volume', 'volume-1', ACTIVE_RUN),
    ]);

    await expect(
      reconciler?.reconcileOrphanedRunResources({
        client,
        isRunActive: async (runId: string) => {
          if (runId === ACTIVE_RUN) throw new Error('Temporal unavailable');
          return false;
        },
        minAgeMs: 0,
        maxResources: 20,
        now: () => NOW,
      }),
    ).rejects.toThrow('Temporal unavailable');
    expect(removed).toEqual([]);
  });

  it('bounds active-run lookups and deletes nothing when Temporal does not respond', async () => {
    const reconciler = await import('../orphan-reconciler').catch(() => undefined);
    const { client, removed } = fakeClient([resource('container', 'container-1', INACTIVE_RUN)]);

    await expect(
      reconciler?.reconcileOrphanedRunResources({
        client,
        isRunActive: () => new Promise(() => undefined),
        minAgeMs: 0,
        maxResources: 20,
        runStateTimeoutMs: 10,
        now: () => NOW,
      }),
    ).rejects.toThrow('timed out after 10ms');
    expect(removed).toEqual([]);
  });

  it('aggregates removal failures in a typed error instead of returning success', async () => {
    const reconciler = await import('../orphan-reconciler').catch(() => undefined);
    const removed: string[] = [];
    const client: OrphanResourceClient = {
      listManagedResources: async () => [
        resource('container', 'bad-container', INACTIVE_RUN),
        resource('volume', 'good-volume', INACTIVE_RUN),
      ],
      removeResource: async (candidate) => {
        if (candidate.id === 'bad-container') throw new Error('daemon refused removal');
        removed.push(candidate.id);
      },
    };

    let failure:
      | (Error & {
          report?: ReconciliationReport;
        })
      | undefined;
    try {
      await reconciler?.reconcileOrphanedRunResources({
        client,
        isRunActive: async () => false,
        minAgeMs: 0,
        maxResources: 20,
        now: () => NOW,
      });
    } catch (error: unknown) {
      failure = error as typeof failure;
    }

    expect(failure?.name).toBe('OrphanReconciliationError');
    expect(failure?.message).toContain('bad-container');
    expect(failure?.report?.failures).toEqual([
      {
        kind: 'container',
        id: 'bad-container',
        message: 'daemon refused removal',
      },
    ]);
    expect(removed).toEqual(['good-volume']);
  });
});

describe('orphan resource clients', () => {
  it('inventories and removes only explicitly labeled Docker resources', async () => {
    const calls: string[][] = [];
    const dockerEnv = { DOCKER_HOST: 'tcp://dind:2376' };
    const command: DockerCommand = async (args, options) => {
      calls.push(args);
      expect(options?.env).toBe(dockerEnv);
      expect(options?.timeout).toBe(1_234);

      if (args[0] === 'ps') return { stdout: 'container-1\n', stderr: '' };
      if (args[0] === 'volume' && args[1] === 'ls') {
        return { stdout: 'volume-1\n', stderr: '' };
      }
      if (args[0] === 'inspect') {
        return {
          stdout: JSON.stringify([
            {
              Id: 'container-1',
              Created: OLD.toISOString(),
              Config: { Labels: { ...SCOPE_LABELS, 'sentris.runId': INACTIVE_RUN } },
            },
          ]),
          stderr: '',
        };
      }
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return {
          stdout: JSON.stringify([
            {
              Name: 'volume-1',
              CreatedAt: OLD.toISOString(),
              Labels: {
                ...SCOPE_LABELS,
                'sentris.runId': INACTIVE_RUN,
              },
            },
          ]),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    };
    const client = createDockerOrphanResourceClient({
      command,
      dockerEnv,
      commandTimeoutMs: 1_234,
      resourceScope: RESOURCE_SCOPE,
    });

    const resources = await client.listManagedResources();
    await Promise.all(resources.map((candidate) => client.removeResource(candidate)));

    expect(resources).toEqual([
      resource('container', 'container-1', INACTIVE_RUN),
      resource('volume', 'volume-1', INACTIVE_RUN),
    ]);
    expect(calls).toContainEqual([
      'ps',
      '-aq',
      '--filter',
      'label=sentris.managed=true',
      '--filter',
      'label=sentris.deploymentId=deployment-a',
      '--filter',
      'label=sentris.instance=2',
      '--filter',
      'label=sentris.temporalNamespace=namespace-a',
      '--filter',
      'label=sentris.temporalTaskQueue=queue-a',
    ]);
    expect(calls).toContainEqual([
      'volume',
      'ls',
      '-q',
      '--filter',
      'label=sentris.managed=true',
      '--filter',
      'label=sentris.deploymentId=deployment-a',
      '--filter',
      'label=sentris.instance=2',
      '--filter',
      'label=sentris.temporalNamespace=namespace-a',
      '--filter',
      'label=sentris.temporalTaskQueue=queue-a',
    ]);
    expect(calls).toContainEqual(['rm', '-f', 'container-1']);
    expect(calls).toContainEqual(['volume', 'rm', 'volume-1']);
  });

  it('fails closed on unknown Temporal workflow statuses', async () => {
    const describeWorkflowExecution = vi.fn(async () => ({
      workflowExecutionInfo: { status: 0 },
    }));
    const isRunActive = createTemporalRunActivityResolver(
      { workflowService: { describeWorkflowExecution } },
      'sentris-prod',
    );

    await expect(isRunActive(ACTIVE_RUN)).rejects.toThrow('unknown execution status');
    expect(describeWorkflowExecution).toHaveBeenCalledWith({
      namespace: 'sentris-prod',
      execution: { workflowId: ACTIVE_RUN },
    });
  });

  it('reconciles shared exchange metadata for nested workflow run identifiers', async () => {
    const exchangeRoot = await mkdtemp(join(tmpdir(), 'sentris-orphan-exchange-'));
    const resourceId = '11111111-1111-4111-8111-111111111111';
    const nestedRunId = `${ACTIVE_RUN}:for-each:0`;
    const resourcePath = join(exchangeRoot, 'runs', resourceId);
    const metadataPath = join(exchangeRoot, 'metadata', `${resourceId}.json`);
    await mkdir(resourcePath, { recursive: true });
    await mkdir(join(exchangeRoot, 'metadata'), { recursive: true });
    await writeFile(
      metadataPath,
      JSON.stringify({
        managed: true,
        kind: 'component-io',
        resourceId,
        runId: nestedRunId,
        deploymentId: RESOURCE_SCOPE.deploymentId,
        instanceId: RESOURCE_SCOPE.instanceId,
        temporalNamespace: RESOURCE_SCOPE.temporalNamespace,
        temporalTaskQueue: RESOURCE_SCOPE.temporalTaskQueue,
        createdAt: OLD.toISOString(),
      }),
    );
    const client = createDockerOrphanResourceClient({
      exchangeRoot,
      command: async () => ({ stdout: '', stderr: '' }),
      resourceScope: RESOURCE_SCOPE,
    });

    try {
      const resources = await client.listManagedResources();
      expect(resources).toEqual([resource('exchange-directory', resourceId, nestedRunId)]);
      await client.removeResource(resources[0]!);
      await expect(access(resourcePath)).rejects.toThrow();
      await expect(access(metadataPath)).rejects.toThrow();
    } finally {
      await rm(exchangeRoot, { recursive: true, force: true });
    }
  });

  it('preserves legacy and foreign exchange metadata instead of deleting across worker scopes', async () => {
    const exchangeRoot = await mkdtemp(join(tmpdir(), 'sentris-foreign-exchange-'));
    await mkdir(join(exchangeRoot, 'runs', 'legacy-resource'), { recursive: true });
    await mkdir(join(exchangeRoot, 'runs', 'foreign-resource'), { recursive: true });
    await mkdir(join(exchangeRoot, 'metadata'), { recursive: true });
    await writeFile(
      join(exchangeRoot, 'metadata', 'legacy-resource.json'),
      JSON.stringify({
        managed: true,
        kind: 'component-io',
        resourceId: 'legacy-resource',
        runId: INACTIVE_RUN,
        createdAt: OLD.toISOString(),
      }),
    );
    await writeFile(
      join(exchangeRoot, 'metadata', 'foreign-resource.json'),
      JSON.stringify({
        managed: true,
        kind: 'component-io',
        resourceId: 'foreign-resource',
        runId: INACTIVE_RUN,
        deploymentId: 'deployment-b',
        instanceId: RESOURCE_SCOPE.instanceId,
        temporalNamespace: RESOURCE_SCOPE.temporalNamespace,
        temporalTaskQueue: RESOURCE_SCOPE.temporalTaskQueue,
        createdAt: OLD.toISOString(),
      }),
    );
    const client = createDockerOrphanResourceClient({
      exchangeRoot,
      command: async () => ({ stdout: '', stderr: '' }),
      resourceScope: RESOURCE_SCOPE,
    });

    try {
      expect(await client.listManagedResources()).toEqual([]);
      await access(join(exchangeRoot, 'runs', 'legacy-resource'));
      await access(join(exchangeRoot, 'runs', 'foreign-resource'));
    } finally {
      await rm(exchangeRoot, { recursive: true, force: true });
    }
  });

  it('inspects a 501-resource inventory in deterministic bounded pages instead of crash-looping', async () => {
    const ids = Array.from(
      { length: 501 },
      (_, index) => `container-${String(index).padStart(3, '0')}`,
    );
    const inspectPages: string[][] = [];
    const command: DockerCommand = async (args) => {
      if (args[0] === 'ps') {
        return { stdout: `${[...ids].reverse().join('\n')}\n`, stderr: '' };
      }
      if (args[0] === 'volume' && args[1] === 'ls') return { stdout: '', stderr: '' };
      if (args[0] === 'inspect') {
        const page = args.slice(1);
        inspectPages.push(page);
        return {
          stdout: JSON.stringify(
            page.map((id) => ({
              Id: id,
              Created: OLD.toISOString(),
              Config: { Labels: { ...SCOPE_LABELS, 'sentris.runId': INACTIVE_RUN } },
            })),
          ),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    };
    const client = createDockerOrphanResourceClient({
      command,
      resourceScope: RESOURCE_SCOPE,
      maxInventoryResources: 500,
    });

    const resources = await client.listManagedResources();

    expect(resources).toHaveLength(501);
    expect(inspectPages.map((page) => page.length)).toEqual([500, 1]);
    expect(inspectPages[0]?.[0]).toBe('container-000');
    expect(inspectPages[1]?.[0]).toBe('container-500');
  });

  it('distinguishes running and terminal Temporal workflow statuses', async () => {
    let status: number | string = 1;
    const isRunActive = createTemporalRunActivityResolver(
      {
        workflowService: {
          describeWorkflowExecution: async () => ({
            workflowExecutionInfo: { status },
          }),
        },
      },
      'sentris-prod',
    );

    expect(await isRunActive(ACTIVE_RUN)).toBe(true);
    status = 'WORKFLOW_EXECUTION_STATUS_COMPLETED';
    expect(await isRunActive(ACTIVE_RUN)).toBe(false);
  });
});

describe('periodic orphan reconciler', () => {
  it('runs once at startup and coalesces overlapping periodic triggers', async () => {
    const reconciler = await import('../orphan-reconciler').catch(() => undefined);
    let calls = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reconcile = vi.fn(async (): Promise<ReconciliationReport> => {
      calls += 1;
      if (calls > 1) await blocked;
      return {
        examined: 0,
        eligible: 0,
        preservedActive: 0,
        preservedYoung: 0,
        remainingEligible: 0,
        truncated: false,
        removed: { containers: 0, volumes: 0, exchangeDirectories: 0 },
        failures: [],
      };
    });
    const handle = await reconciler?.startOrphanReconciler({
      reconcile,
      intervalMs: 60 * 60 * 1_000,
    });

    const firstPeriodic = handle?.runNow();
    const overlapping = handle?.runNow();
    await Promise.resolve();

    expect(calls).toBe(2);
    release?.();
    expect(await firstPeriodic).toBe(await overlapping);
    await handle?.close();
  });

  it('surfaces periodic failure and clears it after the next successful pass', async () => {
    const reconciler = await import('../orphan-reconciler').catch(() => undefined);
    const errors: (string | undefined)[] = [];
    let fail = false;
    const handle = await reconciler?.startOrphanReconciler({
      reconcile: async () => {
        if (fail) throw new Error('cleanup failed');
        return {
          examined: 0,
          eligible: 0,
          preservedActive: 0,
          preservedYoung: 0,
          remainingEligible: 0,
          truncated: false,
          removed: { containers: 0, volumes: 0, exchangeDirectories: 0 },
          failures: [],
        };
      },
      intervalMs: 60 * 60 * 1_000,
      onHealthChange: (message) => errors.push(message),
    });

    fail = true;
    await expect(handle?.runNow()).rejects.toThrow('cleanup failed');
    fail = false;
    await handle?.runNow();
    await handle?.close();

    expect(errors).toEqual([undefined, 'cleanup failed', undefined]);
  });
});
