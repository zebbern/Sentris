import type { ExecutionScope } from '@sentris/shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RunMcpRequestContext {
  kind: 'run';
  runId: string;
  organizationId: string | null;
  capabilityGrantId: string;
  capabilitySnapshotId?: string;
  invokingNodeId?: string;
  allowedNodeIds: readonly string[];
}

export function normalizeRunMcpAllowedNodeIds(allowedNodeIds: unknown): string[] {
  if (allowedNodeIds === undefined) {
    return [];
  }
  if (
    !Array.isArray(allowedNodeIds) ||
    allowedNodeIds.some((nodeId) => typeof nodeId !== 'string')
  ) {
    throw invalidRunContext();
  }

  return [...new Set(allowedNodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))].sort();
}

export function parseRunMcpRequestContext(extra: unknown): RunMcpRequestContext {
  if (!isRecord(extra)) {
    throw invalidRunContext();
  }

  const {
    runId,
    organizationId,
    capabilityGrantId,
    capabilitySnapshotId,
    invokingNodeId,
    allowedNodeIds,
  } = extra;
  if (
    typeof runId !== 'string' ||
    runId.trim().length === 0 ||
    (organizationId !== null &&
      (typeof organizationId !== 'string' || organizationId.trim().length === 0)) ||
    typeof capabilityGrantId !== 'string' ||
    !UUID_PATTERN.test(capabilityGrantId) ||
    (capabilitySnapshotId !== undefined &&
      (typeof capabilitySnapshotId !== 'string' || !UUID_PATTERN.test(capabilitySnapshotId))) ||
    (invokingNodeId !== undefined &&
      (typeof invokingNodeId !== 'string' || invokingNodeId.trim().length === 0))
  ) {
    throw invalidRunContext();
  }

  const normalizedNodeIds = Object.freeze(normalizeRunMcpAllowedNodeIds(allowedNodeIds));
  return Object.freeze({
    kind: 'run',
    runId,
    organizationId,
    capabilityGrantId,
    ...(capabilitySnapshotId !== undefined && { capabilitySnapshotId }),
    ...(invokingNodeId !== undefined && { invokingNodeId }),
    allowedNodeIds: normalizedNodeIds,
  });
}

export function toRunExecutionScope(
  context: RunMcpRequestContext,
): Extract<ExecutionScope, { kind: 'run' }> {
  return Object.freeze({
    kind: 'run',
    runId: context.runId,
    organizationId: context.organizationId,
    capabilityGrantId: context.capabilityGrantId,
    ...(context.invokingNodeId !== undefined && { invokingNodeId: context.invokingNodeId }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRunContext(): TypeError {
  return new TypeError('Invalid MCP run authentication context');
}
