const SAFE_LABEL_VALUE = /^[^\0\r\n]{1,256}$/;

export const DOCKER_RESOURCE_LABELS = Object.freeze({
  managed: 'sentris.managed',
  runId: 'sentris.runId',
  deploymentId: 'sentris.deploymentId',
  instanceId: 'sentris.instance',
  temporalNamespace: 'sentris.temporalNamespace',
  temporalTaskQueue: 'sentris.temporalTaskQueue',
});

export interface DockerResourceScope {
  deploymentId: string;
  instanceId: string;
  temporalNamespace: string;
  temporalTaskQueue: string;
}

export interface DockerResourceScopeEnv {
  SENTRIS_DEPLOYMENT_ID?: string;
  SENTRIS_INSTANCE?: string;
  TEMPORAL_NAMESPACE?: string;
  TEMPORAL_TASK_QUEUE?: string;
}

export function normalizeDockerResourceScope(scope: DockerResourceScope): DockerResourceScope {
  return Object.freeze({
    deploymentId: requireLabelValue(scope.deploymentId, 'deploymentId'),
    instanceId: requireLabelValue(scope.instanceId, 'instanceId'),
    temporalNamespace: requireLabelValue(scope.temporalNamespace, 'temporalNamespace'),
    temporalTaskQueue: requireLabelValue(scope.temporalTaskQueue, 'temporalTaskQueue'),
  });
}

function requireLabelValue(value: string, name: string): string {
  if (!SAFE_LABEL_VALUE.test(value)) {
    throw new Error(`${name} must be a non-empty Docker label value without control characters`);
  }
  return value;
}

export function resolveDockerResourceScope(
  env: DockerResourceScopeEnv = process.env as DockerResourceScopeEnv,
): DockerResourceScope {
  return normalizeDockerResourceScope({
    deploymentId: requireLabelValue(env.SENTRIS_DEPLOYMENT_ID ?? 'local', 'SENTRIS_DEPLOYMENT_ID'),
    instanceId: requireLabelValue(env.SENTRIS_INSTANCE ?? '0', 'SENTRIS_INSTANCE'),
    temporalNamespace: requireLabelValue(
      env.TEMPORAL_NAMESPACE ?? 'sentris-dev',
      'TEMPORAL_NAMESPACE',
    ),
    temporalTaskQueue: requireLabelValue(
      env.TEMPORAL_TASK_QUEUE ?? 'sentris-default',
      'TEMPORAL_TASK_QUEUE',
    ),
  });
}

export function createDockerResourceScopeLabels(
  scopeInput: DockerResourceScope,
): Record<string, string> {
  const scope = normalizeDockerResourceScope(scopeInput);
  return {
    [DOCKER_RESOURCE_LABELS.deploymentId]: scope.deploymentId,
    [DOCKER_RESOURCE_LABELS.instanceId]: scope.instanceId,
    [DOCKER_RESOURCE_LABELS.temporalNamespace]: scope.temporalNamespace,
    [DOCKER_RESOURCE_LABELS.temporalTaskQueue]: scope.temporalTaskQueue,
  };
}

export function createManagedDockerLabels(
  runId: string,
  scopeInput: DockerResourceScope = resolveDockerResourceScope(),
): Record<string, string> {
  const scopeLabels = createDockerResourceScopeLabels(scopeInput);
  return {
    [DOCKER_RESOURCE_LABELS.managed]: 'true',
    [DOCKER_RESOURCE_LABELS.runId]: requireLabelValue(runId, 'runId'),
    ...scopeLabels,
  };
}

export function matchesManagedDockerLabels(
  labels: unknown,
  runId: string,
  scope: DockerResourceScope,
): boolean {
  if (!labels || typeof labels !== 'object') return false;
  const record = labels as Record<string, unknown>;
  const expected = createManagedDockerLabels(runId, scope);
  return Object.entries(expected).every(([key, value]) => record[key] === value);
}

export function managedDockerLabelFilters(scope: DockerResourceScope, runId?: string): string[] {
  const labels = runId
    ? createManagedDockerLabels(runId, scope)
    : {
        [DOCKER_RESOURCE_LABELS.managed]: 'true',
        ...createDockerResourceScopeLabels(scope),
      };
  return Object.entries(labels).flatMap(([key, value]) => ['--filter', `label=${key}=${value}`]);
}
