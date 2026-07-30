import { describe, expect, it } from 'bun:test';
import type { DockerResourceScope } from '@sentris/component-sdk';
import type { DockerCommand } from '../orphan-reconciler';

const SCOPE: DockerResourceScope = {
  deploymentId: 'deployment-a',
  instanceId: '5',
  temporalNamespace: 'namespace-a',
  temporalTaskQueue: 'queue-a',
};
const RUN_ID = 'sentris-run-123';
const LABELS = {
  'sentris.managed': 'true',
  'sentris.runId': RUN_ID,
  'sentris.deploymentId': SCOPE.deploymentId,
  'sentris.instance': SCOPE.instanceId,
  'sentris.temporalNamespace': SCOPE.temporalNamespace,
  'sentris.temporalTaskQueue': SCOPE.temporalTaskQueue,
};

describe('run resource cleanup', () => {
  it('deduplicates a registry container name against the exact-label Docker listing', async () => {
    const { cleanupManagedRunResources } = await import('../run-resource-cleanup');
    const canonicalId = 'a'.repeat(64);
    const calls: string[][] = [];
    const command: DockerCommand = async (args) => {
      calls.push(args);
      if (args[0] === 'ps') return { stdout: `${canonicalId}\n`, stderr: '' };
      if (args[0] === 'volume' && args[1] === 'ls') return { stdout: '', stderr: '' };
      if (args[0] === 'inspect') {
        return {
          stdout: JSON.stringify(
            args.slice(1).map(() => ({
              Id: canonicalId,
              Config: { Labels: LABELS },
            })),
          ),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    };

    await expect(
      cleanupManagedRunResources({
        command,
        runId: RUN_ID,
        resourceScope: SCOPE,
        registryContainerIds: ['mcp-server-by-name'],
      }),
    ).resolves.toEqual({
      containersRemoved: 1,
      volumesRemoved: 0,
      hostProxiesStopped: 0,
    });
    expect(calls.filter(([commandName]) => commandName === 'rm')).toEqual([
      ['rm', '-f', canonicalId],
    ]);
  });

  it('lists generic and MCP containers using exact run and worker-scope filters', async () => {
    const cleanup = await import('../run-resource-cleanup').catch(() => undefined);
    const calls: string[][] = [];
    const command: DockerCommand = async (args) => {
      calls.push(args);
      if (args[0] === 'ps') return { stdout: 'generic-running\n', stderr: '' };
      if (args[0] === 'volume' && args[1] === 'ls') return { stdout: 'run-volume\n', stderr: '' };
      if (args[0] === 'inspect') {
        return {
          stdout: JSON.stringify(
            args.slice(1).map((id) => ({
              Id: id,
              Config: { Labels: LABELS },
            })),
          ),
          stderr: '',
        };
      }
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return {
          stdout: JSON.stringify([{ Name: 'run-volume', Labels: LABELS }]),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    };

    const report = await cleanup?.cleanupManagedRunResources({
      command,
      runId: RUN_ID,
      resourceScope: SCOPE,
      registryContainerIds: ['registered-mcp'],
    });

    const exactFilters = [
      '--filter',
      'label=sentris.managed=true',
      '--filter',
      `label=sentris.runId=${RUN_ID}`,
      '--filter',
      'label=sentris.deploymentId=deployment-a',
      '--filter',
      'label=sentris.instance=5',
      '--filter',
      'label=sentris.temporalNamespace=namespace-a',
      '--filter',
      'label=sentris.temporalTaskQueue=queue-a',
    ];
    expect(calls).toContainEqual(['ps', '-aq', ...exactFilters]);
    expect(calls).not.toContainEqual(
      expect.arrayContaining(['--filter', 'name=mcp-server-']) as unknown as string[],
    );
    expect(calls).toContainEqual(['volume', 'ls', '-q', ...exactFilters]);
    expect(calls).toContainEqual(['rm', '-f', 'generic-running']);
    expect(calls).toContainEqual(['rm', '-f', 'registered-mcp']);
    expect(calls).toContainEqual(['volume', 'rm', 'run-volume']);
    expect(report).toEqual({ containersRemoved: 2, volumesRemoved: 1, hostProxiesStopped: 0 });
  });

  it('rejects an unscoped or foreign registry container before any removal', async () => {
    const cleanup = await import('../run-resource-cleanup').catch(() => undefined);
    const calls: string[][] = [];
    const command: DockerCommand = async (args) => {
      calls.push(args);
      if (args[0] === 'ps' || (args[0] === 'volume' && args[1] === 'ls')) {
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'inspect') {
        return {
          stdout: JSON.stringify([
            {
              Id: 'foreign-mcp',
              Config: {
                Labels: {
                  ...LABELS,
                  'sentris.instance': '99',
                },
              },
            },
          ]),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    };

    await expect(
      cleanup?.cleanupManagedRunResources({
        command,
        runId: RUN_ID,
        resourceScope: SCOPE,
        registryContainerIds: ['foreign-mcp'],
      }),
    ).rejects.toThrow('does not match');
    expect(calls.some(([commandName]) => commandName === 'rm')).toBe(false);
  });

  it('rejects unsafe registry handles before invoking Docker', async () => {
    const cleanup = await import('../run-resource-cleanup').catch(() => undefined);
    const command = (() => {
      throw new Error('Docker must not be called');
    }) as DockerCommand;

    await expect(
      cleanup?.cleanupManagedRunResources({
        command,
        runId: RUN_ID,
        resourceScope: SCOPE,
        registryContainerIds: ['; remove-everything'],
      }),
    ).rejects.toThrow('unsafe registry container ID');
  });
});
