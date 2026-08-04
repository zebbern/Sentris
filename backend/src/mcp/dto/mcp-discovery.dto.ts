import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * MCP tool discovered from server
 */
export const McpToolSchema = z.object({
  name: z.string().describe('Tool name'),
  description: z.string().optional().describe('Tool description'),
  inputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for tool input'),
});

/**
 * Discovery workflow status response
 */
/**
 * Input for starting MCP group discovery workflow
 */
export const GroupDiscoveryInputSchema = z.object({
  image: z.string().min(1).optional().describe('Docker image for stdio transport'),
  servers: z
    .array(
      z
        .object({
          name: z.string().min(1).max(191).describe('Server name'),
          transport: z.enum(['http', 'stdio']).describe('Transport type for MCP server'),
          endpoint: z.string().url().optional().describe('HTTP endpoint for HTTP transport'),
          headers: z
            .record(z.string(), z.string())
            .optional()
            .describe('HTTP headers for authentication'),
          command: z.string().optional().describe('Command to run for stdio transport'),
          args: z.array(z.string()).optional().describe('Arguments for stdio command'),
        })
        .refine(
          (data) => {
            if (data.transport === 'http') {
              return !!data.endpoint;
            }
            if (data.transport === 'stdio') {
              return !!data.command;
            }
            return true;
          },
          {
            message: 'HTTP transport requires endpoint, stdio transport requires command',
            path: ['transport'],
          },
        ),
    )
    .min(1)
    .describe('Servers to discover'),
});

export class GroupDiscoveryInputDto extends createZodDto(GroupDiscoveryInputSchema) {}

export const GroupDiscoveryStartResponseSchema = z.object({
  workflowId: z.string().uuid().describe('Unique ID for tracking the discovery workflow'),
  cacheTokens: z
    .record(z.string(), z.string().uuid())
    .describe('Map of server name to cache token'),
  status: z.literal('started').describe('Status indicating workflow has started'),
});

export class GroupDiscoveryStartResponseDto extends createZodDto(
  GroupDiscoveryStartResponseSchema,
) {}

export const GroupDiscoveryResultSchema = z.object({
  name: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  tools: z.array(McpToolSchema).optional(),
  toolCount: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  cacheToken: z.string().uuid().optional(),
});

export const GroupDiscoveryStatusSchema = z.object({
  workflowId: z.string().uuid().describe('Workflow ID'),
  status: z.enum(['running', 'completed', 'failed']).describe('Current status of discovery'),
  results: z.array(GroupDiscoveryResultSchema).optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
});

export class GroupDiscoveryStatusDto extends createZodDto(GroupDiscoveryStatusSchema) {}
