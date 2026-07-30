import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('Docker component I/O workspace', () => {
  it('creates independent run-scoped directories and managed metadata in a shared root', async () => {
    const dockerIo = await import('../docker-io-workspace').catch(() => undefined);
    const sharedRoot = await mkdtemp(join(tmpdir(), 'sentris-shared-io-test-'));
    tempRoots.push(sharedRoot);

    const first = await dockerIo?.createDockerIoWorkspace({
      runId: 'sentris-run-11111111-1111-4111-8111-111111111111',
      sharedRoot,
      resourceScope: {
        deploymentId: 'deployment-a',
        instanceId: '4',
        temporalNamespace: 'namespace-a',
        temporalTaskQueue: 'queue-a',
      },
    });
    const second = await dockerIo?.createDockerIoWorkspace({
      runId: 'sentris-run-11111111-1111-4111-8111-111111111111',
      sharedRoot,
      resourceScope: {
        deploymentId: 'deployment-a',
        instanceId: '4',
        temporalNamespace: 'namespace-a',
        temporalTaskQueue: 'queue-a',
      },
    });

    expect(first?.mountSource).not.toBe(second?.mountSource);
    expect(first?.mountSource.startsWith(join(sharedRoot, 'runs'))).toBe(true);
    expect(first?.inputPath).toBe(join(first!.mountSource, 'input.json'));
    expect(first?.outputPath).toBe(join(first!.mountSource, 'result.json'));

    const metadata = JSON.parse(
      await readFile(join(sharedRoot, 'metadata', `${first?.resourceId}.json`), 'utf8'),
    ) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      managed: true,
      kind: 'component-io',
      resourceId: first?.resourceId,
      runId: 'sentris-run-11111111-1111-4111-8111-111111111111',
      deploymentId: 'deployment-a',
      instanceId: '4',
      temporalNamespace: 'namespace-a',
      temporalTaskQueue: 'queue-a',
    });
    expect(Number.isFinite(Date.parse(String(metadata.createdAt)))).toBe(true);

    await first?.cleanup();
    await second?.cleanup();
  });

  it('supports nested workflow run identifiers without embedding them in paths', async () => {
    const dockerIo = await import('../docker-io-workspace').catch(() => undefined);
    const sharedRoot = await mkdtemp(join(tmpdir(), 'sentris-nested-io-test-'));
    tempRoots.push(sharedRoot);
    const nestedRunId = 'sentris-run-11111111-1111-4111-8111-111111111111:for-each:0';

    const workspace = await dockerIo?.createDockerIoWorkspace({
      runId: nestedRunId,
      sharedRoot,
      resourceScope: {
        deploymentId: 'deployment-a',
        instanceId: '4',
        temporalNamespace: 'namespace-a',
        temporalTaskQueue: 'queue-a',
      },
    });
    const metadata = JSON.parse(
      await readFile(join(sharedRoot, 'metadata', `${workspace?.resourceId}.json`), 'utf8'),
    ) as Record<string, unknown>;

    expect(workspace?.resourceId).not.toContain(':');
    expect(metadata.runId).toBe(nestedRunId);
    await workspace?.cleanup();
  });
});
