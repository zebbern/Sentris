import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  outputs,
  inputs,
  parameters,
  param,
  port,
} from '@sentris/component-sdk';
import {
  fetchEnabledServers,
  registerProviderReady,
  registerServerTools,
} from './mcp-library-utils';

const inputSchema = inputs({});

const parameterSchema = parameters({
  enabledServers: param(
    z.array(z.string()).default([]).describe('Array of MCP server IDs to enable'),
    {
      label: 'Enabled Servers',
      editor: 'multi-select',
      description: 'Select MCP servers to enable tools from',
    },
  ),
  useAllEnabled: param(
    z.boolean().default(false).describe('Expose every enabled custom MCP server at run time'),
    {
      label: 'Use All Enabled Servers',
      editor: 'boolean',
      description:
        'Expose all enabled custom MCP servers from the MCP library. Useful for reusable templates where server IDs differ between environments.',
    },
  ),
  continueOnServerError: param(
    z
      .boolean()
      .default(false)
      .describe('Continue the workflow when an optional MCP server cannot be started or queried'),
    {
      label: 'Continue On Server Error',
      editor: 'boolean',
      description:
        'Keep the workflow running if one selected MCP server is unavailable. Successfully discovered servers are still exposed to connected agents.',
    },
  ),
});

const outputSchema = outputs({
  tools: port(z.unknown().optional().describe('MCP tools from selected servers'), {
    label: 'Tools',
    description: 'MCP tools from selected servers',
    connectionType: { kind: 'contract', name: 'mcp.tool' },
    allowAny: true,
    reason:
      'MCP tools are dynamically discovered from the server at runtime and cannot have a fixed schema',
  }),
});

const definition = defineComponent({
  id: 'mcp.custom',
  label: 'Custom MCPs',
  category: 'mcp',
  runner: {
    kind: 'inline',
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Select and enable custom MCP servers. All tools from selected servers will be available to connected AI agents.',
  toolProvider: {
    kind: 'mcp-group',
    name: 'mcp_library',
    description: 'Expose custom MCP tools from configured servers.',
  },
  ui: {
    slug: 'mcp-library',
    version: '1.0.0',
    type: 'process',
    category: 'mcp',
    description: 'Select multiple custom MCP servers to expose their tools to AI agents.',
    icon: 'Library',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
  },
  async execute({ params }, context) {
    const enabledServers = params.enabledServers as string[];
    const useAllEnabled = params.useAllEnabled === true;
    const continueOnServerError = params.continueOnServerError === true;

    // 1. Fetch server details from backend
    const servers = await fetchEnabledServers(enabledServers, context, { useAllEnabled });

    // 2. Register each server's tools with Tool Registry
    for (const server of servers) {
      try {
        await registerServerTools(server, context);
      } catch (error) {
        if (!continueOnServerError) {
          throw error;
        }
        console.warn(
          `[mcp.custom] Skipping unavailable MCP server ${server.name} (${server.id}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // 3. Mark the parent MCP provider node ready for agent tool-dependency checks.
    await registerProviderReady(context);

    // 4. Return empty (tools are registered, not returned as data)
    return {};
  },
});

componentRegistry.register(definition);

export type McpLibraryInput = typeof inputSchema;
export type McpLibraryParams = typeof parameterSchema;
export type McpLibraryOutput = typeof outputSchema;
