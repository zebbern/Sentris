export const MCP_RUNTIME_MAX_CONFIGURED_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
export const MCP_RUNTIME_MAX_DOCKER_INVENTORY = 1_024;

export const MCP_RUNTIME_ROUTED_OPERATION_OVERHEAD_MS = 5_000;
export const MCP_RUNTIME_MAX_ROUTED_OPERATION_OVERHEAD_MS = 60_000;
export const MCP_RUNTIME_MAX_ROUTED_REQUEST_TIMEOUT_MS =
  MCP_RUNTIME_MAX_CONFIGURED_TIMEOUT_MS + MCP_RUNTIME_MAX_ROUTED_OPERATION_OVERHEAD_MS;

export const SAVED_MCP_RUNTIME_DISCOVERY_START_TO_CLOSE_MS = 30 * 60 * 1_000;
export const SAVED_MCP_RUNTIME_DISCOVERY_RELEASE_TIMEOUT_MS = 2 * 60 * 1_000;
export const SAVED_MCP_RUNTIME_DISCOVERY_FIXED_OVERHEAD_MS = 60_000;

/** Default ready-lease TTL mirrored by `MCP_RUNTIME_LEASE_TTL_MS`. */
export const MCP_RUNTIME_DEFAULT_READY_LEASE_TTL_MS = 60_000;
/** Default starting-lease TTL mirrored by `MCP_RUNTIME_STARTING_TTL_MS`. */
export const MCP_RUNTIME_DEFAULT_STARTING_LEASE_TTL_MS = 180_000;

/**
 * Temporal retry policy for saved MCP discovery.
 * Cumulative backoff before the final attempt must outwait a hard-crash starting lease
 * (default 180s) even when each attempt fails in seconds:
 * 30s + 60s + 60s + 60s = 210s across five attempts.
 */
export const SAVED_MCP_RUNTIME_DISCOVERY_RETRY = {
  initialInterval: '30 seconds',
  backoffCoefficient: 2,
  maximumInterval: '60 seconds',
  maximumAttempts: 5,
} as const;

export const SAVED_MCP_RUNTIME_DISCOVERY_RETRY_COVERAGE_MS = 210_000;

export interface McpRuntimeOperationTimeoutContext {
  maxTotalTimeoutMs: number;
}

export function resolveMcpRuntimeRoutedRequestTimeout(
  context: McpRuntimeOperationTimeoutContext,
  overheadMs = MCP_RUNTIME_ROUTED_OPERATION_OVERHEAD_MS,
): number {
  if (
    !Number.isInteger(context.maxTotalTimeoutMs) ||
    context.maxTotalTimeoutMs <= 0 ||
    context.maxTotalTimeoutMs > MCP_RUNTIME_MAX_CONFIGURED_TIMEOUT_MS
  ) {
    throw new Error('MCP runtime operation total timeout is outside its supported range');
  }
  if (
    !Number.isInteger(overheadMs) ||
    overheadMs < 0 ||
    overheadMs > MCP_RUNTIME_MAX_ROUTED_OPERATION_OVERHEAD_MS
  ) {
    throw new Error('MCP runtime routed-operation overhead is outside its supported range');
  }
  return context.maxTotalTimeoutMs + overheadMs;
}
