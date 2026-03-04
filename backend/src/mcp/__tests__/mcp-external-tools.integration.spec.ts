/**
 * Integration tests for Bug 10 fix: external MCP tool calling with raw JSON Schema.
 *
 * Verifies that:
 * 1. External tools can be registered without Zod `inputSchema` (no crash on safeParseAsync)
 * 2. ListTools returns raw JSON Schema (not empty `{type: "object"}`)
 * 3. Calling external tools with arbitrary arguments succeeds without validation errors
 *
 * These tests directly instantiate McpServer (same approach as mcp-gateway.spec.ts)
 * and simulate the registration + patching flow used by McpGatewayService.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * Reproduces the `patchListToolsWithExternalSchemas` logic from McpGatewayService.
 * Overrides the ListTools handler to inject raw JSON schemas stored in the map.
 */
function patchListToolsWithExternalSchemas(
  server: McpServer,
  externalToolSchemas: Map<string, Record<string, unknown>>,
): void {
  if (externalToolSchemas.size === 0) return;

  const schemasSnapshot = new Map(externalToolSchemas);

  const registeredTools = (server as any)._registeredTools as Record<
    string,
    { enabled: boolean; description?: string; annotations?: any; _meta?: any }
  >;

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Object.entries(registeredTools)
      .filter(([, tool]) => tool.enabled)
      .map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: schemasSnapshot.get(name) ?? { type: 'object' as const },
        annotations: tool.annotations,
        _meta: tool._meta,
      })),
  }));
}

/**
 * Invokes the tools/call handler on a McpServer directly, bypassing transport.
 * This simulates what happens when an MCP client calls a tool.
 */
async function invokeToolCall(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<any> {
  const requestHandlers = (server.server as any)._requestHandlers as Map<
    string,
    (request: any, extra: any) => Promise<any>
  >;
  const callHandler = requestHandlers.get('tools/call');
  if (!callHandler) {
    throw new Error('tools/call handler not registered');
  }

  return callHandler(
    { method: 'tools/call', params: { name: toolName, arguments: args } },
    { signal: new AbortController().signal },
  );
}

/**
 * Invokes the tools/list handler on a McpServer directly, bypassing transport.
 */
async function invokeListTools(
  server: McpServer,
): Promise<{ tools: { name: string; description?: string; inputSchema: any }[] }> {
  const requestHandlers = (server.server as any)._requestHandlers as Map<
    string,
    (request: any, extra: any) => Promise<any> | any
  >;
  const listHandler = requestHandlers.get('tools/list');
  if (!listHandler) {
    throw new Error('tools/list handler not registered');
  }

  return listHandler(
    { method: 'tools/list', params: {} },
    { signal: new AbortController().signal },
  );
}

/**
 * Simulated tool callback for external tools.
 *
 * NOTE: When `inputSchema` is omitted from registerTool(), the MCP SDK calls
 * `handler(extra)` instead of `handler(args, extra)`. So the first argument
 * received is the ServerExtra context (containing `signal`), not the tool call
 * arguments. This mirrors production behavior — the real gateway uses
 * `proxyCallToExternal()` which reads args from the request directly.
 */
const createExternalToolCallback =
  (expectedToolName: string) =>
  async (..._receivedArgs: unknown[]) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ source: expectedToolName, callbackInvoked: true }),
      },
    ],
  });

describe('MCP External Tools Integration (Bug 10 fix)', () => {
  let server: McpServer;
  let externalToolSchemas: Map<string, Record<string, unknown>>;

  beforeEach(() => {
    server = new McpServer({ name: 'test-gateway', version: '1.0.0' });
    externalToolSchemas = new Map();
  });

  describe('External tool registration with raw JSON Schema', () => {
    it('registers an external tool without inputSchema (no Zod)', () => {
      const rawSchema = {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results' },
        },
        required: ['query'],
      };

      server.registerTool(
        'aws_cloudtrail__lookup_events',
        { description: 'Lookup CloudTrail events' },
        createExternalToolCallback('lookup_events'),
      );
      externalToolSchemas.set('aws_cloudtrail__lookup_events', rawSchema);

      const registeredTools = (server as any)._registeredTools;
      const tool = registeredTools['aws_cloudtrail__lookup_events'];
      expect(tool).toBeDefined();
      expect(tool.enabled).toBe(true);
      expect(tool.description).toBe('Lookup CloudTrail events');
      expect(tool.inputSchema).toBeUndefined();
    });

    it('registers multiple external tools from different servers', () => {
      const schemas: Record<string, Record<string, unknown>> = {
        github__list_repos: {
          type: 'object',
          properties: { org: { type: 'string' }, per_page: { type: 'number' } },
          required: ['org'],
        },
        slack__send_message: {
          type: 'object',
          properties: { channel: { type: 'string' }, text: { type: 'string' } },
          required: ['channel', 'text'],
        },
      };

      for (const [name, schema] of Object.entries(schemas)) {
        server.registerTool(
          name,
          { description: `Tool: ${name}` },
          createExternalToolCallback(name),
        );
        externalToolSchemas.set(name, schema);
      }

      const registeredTools = (server as any)._registeredTools;
      expect(Object.keys(registeredTools)).toHaveLength(2);
      expect(registeredTools['github__list_repos'].inputSchema).toBeUndefined();
      expect(registeredTools['slack__send_message'].inputSchema).toBeUndefined();
    });
  });

  describe('ListTools returns raw JSON Schema via patching', () => {
    it('returns the raw JSON Schema for external tools', async () => {
      const rawSchema = {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results' },
        },
        required: ['query'],
      };

      server.registerTool(
        'aws_cloudtrail__lookup_events',
        { description: 'Lookup CloudTrail events' },
        createExternalToolCallback('lookup_events'),
      );
      externalToolSchemas.set('aws_cloudtrail__lookup_events', rawSchema);
      patchListToolsWithExternalSchemas(server, externalToolSchemas);

      const result = await invokeListTools(server);

      expect(result.tools).toHaveLength(1);
      const tool = result.tools[0];
      expect(tool.name).toBe('aws_cloudtrail__lookup_events');
      expect(tool.description).toBe('Lookup CloudTrail events');
      expect(tool.inputSchema).toEqual(rawSchema);
      expect(tool.inputSchema.properties.query).toEqual({
        type: 'string',
        description: 'Search query',
      });
      expect(tool.inputSchema.required).toEqual(['query']);
    });

    it('falls back to empty object schema for tools without stored schema', async () => {
      server.registerTool(
        'unknown_tool',
        { description: 'No schema' },
        createExternalToolCallback('unknown_tool'),
      );
      server.registerTool(
        'other_tool',
        { description: 'Has schema' },
        createExternalToolCallback('other_tool'),
      );
      externalToolSchemas.set('other_tool', { type: 'object' });

      patchListToolsWithExternalSchemas(server, externalToolSchemas);

      const result = await invokeListTools(server);
      const unknownTool = result.tools.find((t: { name: string }) => t.name === 'unknown_tool');
      expect(unknownTool).toBeDefined();
      expect(unknownTool!.inputSchema).toEqual({ type: 'object' });
    });

    it('preserves tool description in ListTools response', async () => {
      const description = 'Analyze security logs for suspicious activity';
      server.registerTool(
        'security__analyze_logs',
        { description },
        createExternalToolCallback('analyze_logs'),
      );
      externalToolSchemas.set('security__analyze_logs', { type: 'object' });
      patchListToolsWithExternalSchemas(server, externalToolSchemas);

      const result = await invokeListTools(server);
      const tool = result.tools.find((t: { name: string }) => t.name === 'security__analyze_logs');
      expect(tool).toBeDefined();
      expect(tool!.description).toBe(description);
    });
  });

  describe('External tool calling path (no safeParseAsync crash)', () => {
    it('calls an external tool with matching arguments without validation crash', async () => {
      const rawSchema = {
        type: 'object',
        properties: { query: { type: 'string' }, maxResults: { type: 'number' } },
        required: ['query'],
      };

      server.registerTool(
        'search__find_documents',
        { description: 'Search documents' },
        createExternalToolCallback('find_documents'),
      );
      externalToolSchemas.set('search__find_documents', rawSchema);

      // This MUST NOT throw "safeParseAsync is not a function"
      const result = await invokeToolCall(server, 'search__find_documents', {
        query: 'security incidents',
        maxResults: 10,
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.source).toBe('find_documents');
      expect(parsed.callbackInvoked).toBe(true);
    });

    it('calls an external tool with empty arguments without crash', async () => {
      server.registerTool(
        'health__check',
        { description: 'Health check' },
        createExternalToolCallback('health_check'),
      );
      externalToolSchemas.set('health__check', { type: 'object' });

      const result = await invokeToolCall(server, 'health__check', {});

      expect(result).toBeDefined();
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.source).toBe('health_check');
      expect(parsed.callbackInvoked).toBe(true);
    });

    it('calls an external tool with undefined arguments without crash', async () => {
      server.registerTool(
        'info__get_version',
        { description: 'Get version' },
        createExternalToolCallback('get_version'),
      );
      externalToolSchemas.set('info__get_version', { type: 'object' });

      const result = await invokeToolCall(server, 'info__get_version', undefined as never);

      expect(result).toBeDefined();
      expect(result.content[0].type).toBe('text');
    });

    it('returns correct CallToolResult structure from callback', async () => {
      server.registerTool(
        'abuseipdb__check_ip',
        { description: 'Check IP reputation' },
        // When inputSchema is omitted, SDK calls handler(extra) — first arg is ServerExtra
        async (..._args: unknown[]) => ({
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ status: 'ok', score: 95, reports: 42 }),
            },
          ],
        }),
      );
      externalToolSchemas.set('abuseipdb__check_ip', {
        type: 'object',
        properties: { ipAddress: { type: 'string' } },
        required: ['ipAddress'],
      });

      const result = await invokeToolCall(server, 'abuseipdb__check_ip', {
        ipAddress: '192.168.1.1',
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const data = JSON.parse(result.content[0].text as string);
      expect(data.status).toBe('ok');
      expect(data.score).toBe(95);
    });

    it('handles tool callback errors gracefully', async () => {
      server.registerTool('failing__tool', { description: 'A tool that fails' }, async () => {
        throw new Error('Connection refused');
      });
      externalToolSchemas.set('failing__tool', { type: 'object' });

      const result = await invokeToolCall(server, 'failing__tool', {});
      expect(result).toBeDefined();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Connection refused');
    });
  });

  describe('End-to-end: register + patch + list + call', () => {
    it('full flow: register external tool, patch schemas, list tools, then call', async () => {
      const rawSchema = {
        type: 'object',
        properties: {
          bucketName: { type: 'string', description: 'S3 bucket name' },
          prefix: { type: 'string', description: 'Object key prefix' },
          maxKeys: { type: 'integer', description: 'Maximum number of keys' },
        },
        required: ['bucketName'],
      };

      let callbackWasInvoked = false;
      server.registerTool(
        'aws_s3__list_objects',
        { description: 'List objects in an S3 bucket' },
        async (..._args: unknown[]) => {
          callbackWasInvoked = true;
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ objects: ['file1.txt', 'file2.txt'] }),
              },
            ],
          };
        },
      );
      externalToolSchemas.set('aws_s3__list_objects', rawSchema);
      patchListToolsWithExternalSchemas(server, externalToolSchemas);

      // Verify ListTools returns correct schema
      const listResult = await invokeListTools(server);
      expect(listResult.tools).toHaveLength(1);
      expect(listResult.tools[0].inputSchema.properties.bucketName).toEqual({
        type: 'string',
        description: 'S3 bucket name',
      });

      // Call the tool — no safeParseAsync crash
      const callResult = await invokeToolCall(server, 'aws_s3__list_objects', {
        bucketName: 'my-bucket',
        prefix: 'logs/',
        maxKeys: 100,
      });
      expect(callbackWasInvoked).toBe(true);
      const data = JSON.parse(callResult.content[0].text);
      expect(data.objects).toContain('file1.txt');
    });

    it('mixed: internal tool (with Zod) + external tool (without Zod) coexist', async () => {
      const { z } = await import('zod');
      const internalSchema = z.object({
        target: z.string().describe('Scan target'),
      });

      server.registerTool(
        'internal_scanner',
        { description: 'Internal vulnerability scanner', inputSchema: internalSchema },
        async (args: { target: string }) => ({
          content: [{ type: 'text' as const, text: `Scanning ${args.target}` }],
        }),
      );

      server.registerTool(
        'external_shodan__search',
        { description: 'Shodan search' },
        createExternalToolCallback('shodan_search'),
      );
      externalToolSchemas.set('external_shodan__search', {
        type: 'object',
        properties: { query: { type: 'string' }, facets: { type: 'string' } },
        required: ['query'],
      });

      patchListToolsWithExternalSchemas(server, externalToolSchemas);

      const listResult = await invokeListTools(server);
      expect(listResult.tools).toHaveLength(2);

      const externalTool = listResult.tools.find(
        (t: { name: string }) => t.name === 'external_shodan__search',
      );
      expect(externalTool).toBeDefined();
      expect(externalTool!.inputSchema.properties.query).toEqual({ type: 'string' });

      // Internal tool (with Zod) should receive validated args normally
      const internalResult = await invokeToolCall(server, 'internal_scanner', {
        target: 'example.com',
      });
      expect(internalResult.content[0].text).toBe('Scanning example.com');

      // External tool (without Zod) should be callable without crashes
      const externalResult = await invokeToolCall(server, 'external_shodan__search', {
        query: 'port:443',
      });
      const parsed = JSON.parse(externalResult.content[0].text);
      expect(parsed.callbackInvoked).toBe(true);
    });
  });
});
