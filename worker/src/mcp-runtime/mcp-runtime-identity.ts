import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  McpRuntimeKeySchema,
  McpRuntimeOwnerAddressSchema,
  type McpRuntimeAcquireRequest,
  type McpRuntimeKey,
} from '@sentris/shared';

const OwnerIdSchema = z.string().min(1);
const RuntimeLeaseScopeSchema = z
  .object({
    deploymentId: z.string().min(1),
    instanceId: z.string().min(1),
    temporalNamespace: z.string().min(1),
    temporalTaskQueue: z.string().min(1),
  })
  .strict();

export interface McpRuntimeLeaseScope {
  deploymentId: string;
  instanceId: string;
  temporalNamespace: string;
  temporalTaskQueue: string;
}

export function canonicalizeMcpRuntimeKey(runtimeKey: McpRuntimeKey): McpRuntimeKey {
  return McpRuntimeKeySchema.parse(runtimeKey);
}

export function serializeMcpRuntimeKey(runtimeKey: McpRuntimeKey): string {
  const key = canonicalizeMcpRuntimeKey(runtimeKey);
  return JSON.stringify([
    key.sourceId,
    key.transport,
    key.configFingerprint,
    key.organizationId,
    key.principalPartitionHash,
    key.credentialReference,
    key.credentialGeneration,
  ]);
}

export function hashMcpRuntimeKey(runtimeKey: McpRuntimeKey): string {
  return createHash('sha256').update(serializeMcpRuntimeKey(runtimeKey)).digest('hex');
}

export function createMcpRuntimeLeaseKeyPrefix(scopeInput: McpRuntimeLeaseScope): string {
  const scope = RuntimeLeaseScopeSchema.parse(scopeInput);
  const scopeHash = createHash('sha256')
    .update(
      JSON.stringify([
        scope.deploymentId,
        scope.instanceId,
        scope.temporalNamespace,
        scope.temporalTaskQueue,
      ]),
    )
    .digest('hex');
  return `mcp:runtime:scope:${scopeHash}`;
}

export function hashMcpRuntimeOwner(ownerId: string, ownerEpoch: string): string {
  return createHash('sha256')
    .update(JSON.stringify([OwnerIdSchema.parse(ownerId), z.string().uuid().parse(ownerEpoch)]))
    .digest('hex');
}

export function createMcpRuntimeId(): string {
  return randomUUID();
}

export function createMcpRuntimeProcessIdentity(input: {
  ownerId: string;
  ownerAddress: string;
}): McpRuntimeAcquireRequest['candidateOwner'] {
  return {
    ownerId: OwnerIdSchema.parse(input.ownerId),
    ownerEpoch: randomUUID(),
    ownerAddress: McpRuntimeOwnerAddressSchema.parse(input.ownerAddress),
  };
}
