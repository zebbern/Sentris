import { defineUpdate } from '@temporalio/workflow';
import {
  INSTALL_TOOL_INVOCATION_MANIFEST_UPDATE_NAME,
  MCP_OPERATION_UPDATE_NAME,
  TOOL_INVOCATION_UPDATE_NAME,
  type InstallToolInvocationManifestRequest,
  type McpOperationInvocationRequest,
  type McpOperationResult,
  type ToolInvocationRequest,
  type ToolInvocationResult,
} from '@sentris/shared/mcp-invocation';

export const installToolInvocationManifestUpdate = defineUpdate<
  undefined,
  [InstallToolInvocationManifestRequest]
>(INSTALL_TOOL_INVOCATION_MANIFEST_UPDATE_NAME);

export const executeToolInvocationUpdate = defineUpdate<
  ToolInvocationResult,
  [ToolInvocationRequest]
>(TOOL_INVOCATION_UPDATE_NAME);

export const executeMcpOperationUpdate = defineUpdate<
  McpOperationResult,
  [McpOperationInvocationRequest]
>(MCP_OPERATION_UPDATE_NAME);
