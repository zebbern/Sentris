import { describe, expect, it } from 'bun:test';

describe('isolated Docker volume labels', () => {
  it('uses the same exact run and worker scope as container reconciliation', async () => {
    const isolatedVolume = await import('../isolated-volume').catch(() => undefined);

    const args = isolatedVolume?.buildManagedVolumeCreateArgs({
      tenantId: 'organization-a',
      runId: 'sentris-run-123',
      volumeName: 'tenant-organization-a-run-sentris-run-123-1',
      createdAt: '2026-07-26T12:00:00.000Z',
      resourceScope: {
        deploymentId: 'deployment-a',
        instanceId: '2',
        temporalNamespace: 'namespace-a',
        temporalTaskQueue: 'queue-a',
      },
    });

    expect(args).toEqual([
      '--label',
      'studio.tenant=organization-a',
      '--label',
      'studio.created=2026-07-26T12:00:00.000Z',
      '--label',
      'sentris.managed=true',
      '--label',
      'sentris.runId=sentris-run-123',
      '--label',
      'sentris.deploymentId=deployment-a',
      '--label',
      'sentris.instance=2',
      '--label',
      'sentris.temporalNamespace=namespace-a',
      '--label',
      'sentris.temporalTaskQueue=queue-a',
      'tenant-organization-a-run-sentris-run-123-1',
    ]);
  });
});
