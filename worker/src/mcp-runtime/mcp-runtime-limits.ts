export const MCP_RUNTIME_MAX_CONFIGURED_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
export const MCP_RUNTIME_MAX_DOCKER_INVENTORY = 1_024;

export const MCP_RUNTIME_ROUTED_OPERATION_OVERHEAD_MS = 5_000;
export const MCP_RUNTIME_MAX_ROUTED_OPERATION_OVERHEAD_MS = 60_000;
export const MCP_RUNTIME_MAX_ROUTED_REQUEST_TIMEOUT_MS =
  MCP_RUNTIME_MAX_CONFIGURED_TIMEOUT_MS + MCP_RUNTIME_MAX_ROUTED_OPERATION_OVERHEAD_MS;

export const SAVED_MCP_RUNTIME_DISCOVERY_START_TO_CLOSE_MS = 30 * 60 * 1_000;
export const SAVED_MCP_RUNTIME_DISCOVERY_RELEASE_TIMEOUT_MS = 2 * 60 * 1_000;
export const SAVED_MCP_RUNTIME_DISCOVERY_FIXED_OVERHEAD_MS = 60_000;

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
