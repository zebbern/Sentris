import { ToolInputSchema } from '@sentris/component-sdk';
import {
  MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS,
  PreparedInvocationRefSchema,
  McpRuntimeKeySchema,
  ToolInvocationRequestSchema,
  ToolInvocationResultSchema,
  type JsonSchemaDocument,
  type McpIcon,
  type McpToolRegistrationDescriptor,
} from '@sentris/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Tool discovered from an MCP server.
 * Matches the MCP protocol's tools/list response.
 */
export class McpToolDefinition implements McpToolRegistrationDescriptor {
  name!: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchemaDocument;
  outputSchema?: JsonSchemaDocument;
  icons?: McpIcon[];
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

/**
 * Input for registering an MCP server proxy.
 * This registers the *server* as a tool source with pre-discovered tools.
 */
export class RegisterMcpServerInput {
  runId!: string;
  /** The node ID in the workflow graph (e.g., 'mcp-library' or 'aws-mcp-group/cloudtrail') */
  nodeId!: string;
  /** Human-readable server name (e.g., 'AWS CloudTrail') */
  serverName!: string;
  /** Optional: MCP server ID from the database (for pre-configured servers) */
  serverId?: string;
  /** Transport type */
  transport!: 'http' | 'stdio';
  /** The HTTP endpoint to proxy requests to */
  endpoint!: string;
  /** For stdio servers, the container ID for cleanup */
  containerId?: string;
  /** Headers to pass when connecting to the server (e.g., auth tokens) */
  headers?: Record<string, string>;
  /**
   * Pre-discovered tools from the server.
   * If provided, the gateway can use these immediately instead of discovering on first connection.
   */
  tools?: McpToolDefinition[];
}

/**
 * Input for registering a component tool
 */
export class RegisterComponentToolInput {
  runId!: string;
  nodeId!: string;
  toolName!: string;
  /**
   * Whether this tool should be exposed to AI agents via the MCP gateway.
   * Some nodes run in tool-mode for dependency readiness only (e.g. MCP group providers).
   *
   * Defaults to true for backwards compatibility.
   */
  exposedToAgent?: boolean;
  componentId!: string;
  description!: string;
  inputSchema!: ToolInputSchema;
  credentials!: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  providerKind?: 'component' | 'mcp-server' | 'mcp-group';
}

/**
 * Input for generating an MCP session token
 */
export class GenerateTokenInput {
  runId!: string;
  organizationId?: string | null;
  agentId?: string;
  invokingNodeId?: string;
  allowedNodeIds?: string[];
  ttlSeconds?: number;
}

/**
 * Input for cleaning up a run's MCP resources
 */
export class CleanupRunInput {
  runId!: string;
}

/**
 * Input for checking if all required tools are ready
 */
export class ToolsReadyInput {
  runId!: string;
  requiredNodeIds!: string[];
}

/**
 * Input for registering a group server
 */
export class RegisterGroupServerInput {
  runId!: string;
  nodeId!: string;
  groupSlug!: string;
  serverId!: string;
}

export const PrepareMcpInvocationBodySchema = z
  .object({ request: ToolInvocationRequestSchema })
  .strict();
export class PrepareMcpInvocationBody extends createZodDto(PrepareMcpInvocationBodySchema) {}

export const ClaimMcpInvocationBodySchema = z.object({ ref: PreparedInvocationRefSchema }).strict();
export class ClaimMcpInvocationBody extends createZodDto(ClaimMcpInvocationBodySchema) {}

export const SettleMcpInvocationBodySchema = z
  .object({ ref: PreparedInvocationRefSchema, result: ToolInvocationResultSchema })
  .strict();
export class SettleMcpInvocationBody extends createZodDto(SettleMcpInvocationBodySchema) {}

const boundedInvocationMessage = z.string().min(1).max(MAX_TOOL_INVOCATION_ERROR_MESSAGE_CHARS);

export const AmbiguousMcpInvocationBodySchema = z
  .object({
    ref: PreparedInvocationRefSchema,
    message: boundedInvocationMessage,
    completedAt: z.string().datetime(),
  })
  .strict();
export class AmbiguousMcpInvocationBody extends createZodDto(AmbiguousMcpInvocationBodySchema) {}

export const ReconcileMcpInvocationBodySchema = z
  .object({
    ref: PreparedInvocationRefSchema,
    cause: z.enum(['failure', 'deadline', 'cancelled']),
    message: boundedInvocationMessage,
    completedAt: z.string().datetime(),
  })
  .strict();
export class ReconcileMcpInvocationBody extends createZodDto(ReconcileMcpInvocationBodySchema) {}

export const ReconcileRunMcpInvocationsBodySchema = z
  .object({
    runId: z.string().min(1),
    message: boundedInvocationMessage,
    completedAt: z.string().datetime(),
  })
  .strict();
export class ReconcileRunMcpInvocationsBody extends createZodDto(
  ReconcileRunMcpInvocationsBodySchema,
) {}

export const ResolveMcpRuntimeDefinitionBodySchema = z
  .object({ runtimeKey: McpRuntimeKeySchema })
  .strict();
export class ResolveMcpRuntimeDefinitionBody extends createZodDto(
  ResolveMcpRuntimeDefinitionBodySchema,
) {}
