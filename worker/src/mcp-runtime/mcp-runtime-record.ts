import type { McpCatalog, McpRuntimeKey, McpRuntimeRef } from '@sentris/shared';

import type {
  McpRuntimeDefinition,
  McpRuntimeDriver,
  McpRuntimeDriverHandle,
} from './mcp-runtime-driver';

export type McpReadyRuntimeRef = Extract<McpRuntimeRef, { state: 'ready' }>;
export type McpRuntimeRecordState = 'starting' | 'active' | 'draining' | 'self-fenced' | 'closed';

export interface McpRuntimeHolderLease {
  expiresAtMs: number;
  inFlight: number;
}

export interface McpRuntimeRecord {
  readonly runtimeKey: McpRuntimeKey;
  readonly definition: McpRuntimeDefinition;
  readonly driver: McpRuntimeDriver;
  readonly handle: McpRuntimeDriverHandle;
  readonly catalog: McpCatalog;
  readonly lifecycleAbort: AbortController;
  readonly activeOperations: Set<Promise<unknown>>;
  /** Owner-local, idle-expiring holders for callers that retained this full fence. */
  readonly holders: Map<string, McpRuntimeHolderLease>;
  /** Released holder incarnations stay fenced for the lifetime of this runtime generation. */
  readonly releasedHolders: Set<string>;
  /** Bounds the acquire-to-retain gap without draining a newly published runtime immediately. */
  unclaimedExpiresAtMs?: number;
  ref: McpRuntimeRef;
  state: McpRuntimeRecordState;
  accepting: boolean;
  fenceLoss?: unknown;
  renewFlight?: Promise<McpReadyRuntimeRef>;
  renewFlightToken?: symbol;
  releaseFlight?: Promise<void>;
  cleanupFlight?: Promise<void>;
}

export function sameMcpRuntimeFence(
  left: McpRuntimeRef['fence'],
  right: McpRuntimeRef['fence'],
): boolean {
  return (
    left.runtimeId === right.runtimeId &&
    left.ownerId === right.ownerId &&
    left.ownerEpoch === right.ownerEpoch &&
    left.leaseGeneration === right.leaseGeneration
  );
}
