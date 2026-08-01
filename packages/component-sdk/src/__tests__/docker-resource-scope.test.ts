import { describe, expect, it } from 'bun:test';

describe('Docker resource scope', () => {
  it('builds the exact managed-resource labels from deployment and Temporal scope', async () => {
    const resourceScope = await import('../docker-resource-scope').catch(() => undefined);

    const scope = resourceScope?.resolveDockerResourceScope({
      SENTRIS_DEPLOYMENT_ID: 'sentris-prod-eu',
      SENTRIS_INSTANCE: '3',
      TEMPORAL_NAMESPACE: 'sentris-prod',
      TEMPORAL_TASK_QUEUE: 'sentris-prod-workers',
    });

    expect(scope).toEqual({
      deploymentId: 'sentris-prod-eu',
      instanceId: '3',
      temporalNamespace: 'sentris-prod',
      temporalTaskQueue: 'sentris-prod-workers',
    });
    expect(resourceScope?.createManagedDockerLabels('sentris-run-123', scope!)).toEqual({
      'sentris.managed': 'true',
      'sentris.runId': 'sentris-run-123',
      'sentris.deploymentId': 'sentris-prod-eu',
      'sentris.instance': '3',
      'sentris.temporalNamespace': 'sentris-prod',
      'sentris.temporalTaskQueue': 'sentris-prod-workers',
    });
    expect(resourceScope?.createDockerResourceScopeLabels(scope!)).toEqual({
      'sentris.deploymentId': 'sentris-prod-eu',
      'sentris.instance': '3',
      'sentris.temporalNamespace': 'sentris-prod',
      'sentris.temporalTaskQueue': 'sentris-prod-workers',
    });
  });

  it('rejects label values that cannot be matched exactly by cleanup filters', async () => {
    const resourceScope = await import('../docker-resource-scope').catch(() => undefined);

    expect(() =>
      resourceScope?.resolveDockerResourceScope({
        SENTRIS_DEPLOYMENT_ID: 'prod\nforeign',
        SENTRIS_INSTANCE: '0',
        TEMPORAL_NAMESPACE: 'sentris-prod',
        TEMPORAL_TASK_QUEUE: 'sentris-prod',
      }),
    ).toThrow('SENTRIS_DEPLOYMENT_ID');
    expect(() =>
      resourceScope?.createManagedDockerLabels('run\nforeign', {
        deploymentId: 'prod',
        instanceId: '0',
        temporalNamespace: 'sentris-prod',
        temporalTaskQueue: 'sentris-prod',
      }),
    ).toThrow('runId');
  });
});
