import { describe, expect, test } from 'bun:test';

import { InputRequiredUnsupportedError, McpClientAdapter } from '../mcp-client-adapter';
import type { McpOperationContext } from '../mcp-client-adapter.types';

const context = (overrides: Partial<McpOperationContext> = {}): McpOperationContext => ({
  signal: new AbortController().signal,
  idleTimeoutMs: 100,
  maxTotalTimeoutMs: 200,
  ...overrides,
});
const tool = {
  canonicalName: 'sentris.echo',
  displayName: 'Echo',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  source: {
    kind: 'mcp',
    sourceId: 'source',
    upstreamName: 'echo',
    bindingFingerprint: 'a'.repeat(64),
  },
  title: 'Echo',
  description: 'Echoes input',
  icons: [{ src: 'icon.svg' }],
  annotations: { readOnlyHint: true },
  meta: { snapshot: true },
  effects: 'unknown',
  effectsSource: 'unknown',
  retryPolicy: 'pre-dispatch-only',
} as const;

describe('McpClientAdapter', () => {
  test('normalizes every named MCP result variant without dropping metadata', () => {
    const adapter = new McpClientAdapter({} as never);

    expect(
      adapter.normalizeResult({
        content: [
          {
            type: 'text',
            text: 'hello',
            annotations: { audience: ['user'] },
            _meta: { source: 'test' },
          },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
          { type: 'audio', data: 'aGVsbG8=', mimeType: 'audio/wav' },
          {
            type: 'resource',
            resource: { uri: 'file:///report.txt', mimeType: 'text/plain', text: 'report' },
          },
          { type: 'resource_link', name: 'report', uri: 'file:///report.txt' },
        ],
        structuredContent: { ok: true },
        isError: true,
        description: 'Prompt context',
        _meta: { request: 'metadata' },
      }),
    ).toEqual({
      content: [
        {
          type: 'text',
          text: 'hello',
          annotations: { audience: ['user'] },
          meta: { source: 'test' },
        },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
        { type: 'audio', data: 'aGVsbG8=', mimeType: 'audio/wav' },
        {
          type: 'resource',
          resource: { uri: 'file:///report.txt', mimeType: 'text/plain', text: 'report' },
        },
        { type: 'resource_link', name: 'report', uri: 'file:///report.txt' },
      ],
      structuredContent: { ok: true },
      isError: true,
      description: 'Prompt context',
      meta: { request: 'metadata' },
    });
  });

  test('normalizes only MCP protocol metadata positions', () => {
    const adapter = new McpClientAdapter({} as never);

    expect(
      adapter.normalizeResult({
        content: [
          {
            type: 'text',
            text: 'hello',
            _meta: { nested: { _meta: { business: true } } },
            opaquePayload: { _meta: { business: true } },
          },
          {
            type: 'resource',
            _meta: { block: true },
            resource: {
              uri: 'fixture://embedded',
              text: 'embedded',
              _meta: { nested: { _meta: { business: true } } },
              opaquePayload: { _meta: { business: true } },
            },
          },
        ],
        contents: [
          {
            uri: 'fixture://report',
            text: 'report',
            _meta: { nested: { _meta: { business: true } } },
            opaquePayload: { _meta: { business: true } },
          },
        ],
        messages: [
          {
            role: 'user',
            _meta: { opaqueMessageData: true },
            content: {
              type: 'text',
              text: 'prompt',
              _meta: { nested: { _meta: { business: true } } },
              opaquePayload: { _meta: { business: true } },
            },
          },
        ],
        structuredContent: {
          _meta: { business: true },
          nested: { _meta: { alsoBusiness: true } },
        },
        _meta: { nested: { _meta: { business: true } } },
      } as never),
    ).toEqual({
      content: [
        {
          type: 'text',
          text: 'hello',
          meta: { nested: { _meta: { business: true } } },
          opaquePayload: { _meta: { business: true } },
        },
        {
          type: 'resource',
          meta: { block: true },
          resource: {
            uri: 'fixture://embedded',
            text: 'embedded',
            meta: { nested: { _meta: { business: true } } },
            opaquePayload: { _meta: { business: true } },
          },
        },
      ],
      contents: [
        {
          uri: 'fixture://report',
          text: 'report',
          meta: { nested: { _meta: { business: true } } },
          opaquePayload: { _meta: { business: true } },
        },
      ],
      messages: [
        {
          role: 'user',
          _meta: { opaqueMessageData: true },
          content: {
            type: 'text',
            text: 'prompt',
            meta: { nested: { _meta: { business: true } } },
            opaquePayload: { _meta: { business: true } },
          },
        },
      ],
      structuredContent: {
        _meta: { business: true },
        nested: { _meta: { alsoBusiness: true } },
      },
      meta: { nested: { _meta: { business: true } } },
    });
  });

  test('rejects decreasing progress across changing totals before reporting it', async () => {
    const progress: { progress: number; total?: number; message?: string }[] = [];
    const adapter = new McpClientAdapter(
      {
        callTool: async (
          _params: unknown,
          options: { onprogress: (value: { progress: number; total?: number }) => void },
        ) => {
          options.onprogress({ progress: 2, total: 4 });
          options.onprogress({ progress: 1, total: 1 });
          options.onprogress({ progress: 3, total: 100 });
          return { content: [] };
        },
      } as never,
      {
        progressIntervalMs: 0,
      },
    );

    await adapter.callTool(
      tool as never,
      {},
      context({
        progressReporter: (value) => progress.push(value),
      }),
    );

    expect(progress).toEqual([
      { progress: 2, total: 4 },
      { progress: 3, total: 100 },
    ]);
  });

  test('rate-limits monotonic progress with the injected clock', async () => {
    const progress: number[] = [];
    let now = 0;
    const adapter = new McpClientAdapter(
      {
        callTool: async (
          _params: unknown,
          options: { onprogress: (value: { progress: number }) => void },
        ) => {
          options.onprogress({ progress: 1 });
          now = 50;
          options.onprogress({ progress: 2 });
          now = 100;
          options.onprogress({ progress: 3 });
          return { content: [] };
        },
      } as never,
      { progressIntervalMs: 100, now: () => now },
    );

    await adapter.callTool(
      tool as never,
      {},
      context({ progressReporter: (event) => progress.push(event.progress) }),
    );

    expect(progress).toEqual([1, 3]);
  });

  test('preserves nested metadata in resource contents and prompt messages', () => {
    const adapter = new McpClientAdapter({} as never);

    expect(
      adapter.normalizeResult({
        contents: [{ uri: 'fixture://report', text: 'report', _meta: { resource: true } }],
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: 'hello', _meta: { content: true } },
            _meta: { message: true },
          },
        ],
      } as never),
    ).toEqual({
      contents: [{ uri: 'fixture://report', text: 'report', meta: { resource: true } }],
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: 'hello', meta: { content: true } },
          _meta: { message: true },
        },
      ],
    });
  });

  test('forwards operation limits, cancellation, cache rules, and the snapshotted SDK tool', async () => {
    const calls: { method: string; options: any; params: any }[] = [];
    const client = {
      callTool: async (params: any, options: any) => {
        calls.push({ method: 'tool', params, options });
        return { content: [] };
      },
      readResource: async (params: any, options: any) => {
        calls.push({ method: 'resource', params, options });
        return { contents: [] };
      },
      getPrompt: async (params: any, options: any) => {
        calls.push({ method: 'prompt', params, options });
        return { messages: [] };
      },
    };
    const adapter = new McpClientAdapter(client as never);
    const operation = context();
    await adapter.callTool(tool as never, { value: 'x' }, operation);
    await adapter.readResource('fixture://report', operation);
    await adapter.getPrompt('greeting', { name: 'Sentris' }, operation);

    for (const call of calls) {
      expect(call.options).toMatchObject({
        signal: operation.signal,
        timeout: 100,
        resetTimeoutOnProgress: true,
        maxTotalTimeout: 200,
        allowInputRequired: true,
      });
    }
    expect(calls[0]!.options).not.toHaveProperty('cacheMode');
    expect(calls[1]!.options.cacheMode).toBe('refresh');
    expect(calls[2]!.options).not.toHaveProperty('cacheMode');
    expect(calls[0]!.options.toolDefinition).toEqual({
      name: 'echo',
      title: 'Echo',
      description: 'Echoes input',
      inputSchema: tool.inputSchema,
      icons: tool.icons,
      annotations: tool.annotations,
      _meta: tool.meta,
    });
  });

  test('rejects invalid finite timeouts before dispatch', async () => {
    let dispatched = false;
    const adapter = new McpClientAdapter({
      callTool: async () => {
        dispatched = true;
        return { content: [] };
      },
    } as never);
    await expect(
      adapter.callTool(tool as never, {}, context({ idleTimeoutMs: Infinity })),
    ).rejects.toThrow('finite positive');
    expect(dispatched).toBe(false);
  });

  test('keeps concurrent operation progress state independent and maps input-required to a typed sentinel', async () => {
    const events: { progress: number; total?: number; message?: string }[] = [];
    let invocation = 0;
    const adapter = new McpClientAdapter(
      {
        callTool: async (_params: any, options: any) => {
          invocation += 1;
          options.onprogress({ progress: invocation, total: 2, message: `call-${invocation}` });
          return invocation === 3
            ? { resultType: 'input_required', inputRequests: {} }
            : { content: [] };
        },
      } as never,
      { progressIntervalMs: 1_000 },
    );
    const progressContext = () => context({ progressReporter: (event) => events.push(event) });
    await Promise.all([
      adapter.callTool(tool as never, {}, progressContext()),
      adapter.callTool(tool as never, {}, progressContext()),
    ]);
    expect(events).toEqual([
      { progress: 1, total: 2, message: 'call-1' },
      { progress: 2, total: 2, message: 'call-2' },
    ]);
    await expect(adapter.callTool(tool as never, {}, progressContext())).rejects.toMatchObject({
      kind: 'input-required-unsupported',
      retryable: false,
      message: 'MCP server requires interactive input',
    } satisfies Partial<InputRequiredUnsupportedError>);
  });

  test('retains legacy public server identity as metadata while using capabilities for discovery', async () => {
    const adapter = new McpClientAdapter({
      getProtocolEra: () => 'legacy',
      getNegotiatedProtocolVersion: () => '2025-11-25',
      getDiscoverResult: () => undefined,
      getServerVersion: () => ({ name: 'fixture', version: '1.0.0' }),
      getServerCapabilities: () => ({ tools: {} }),
      getInstructions: () => 'metadata only',
      listTools: async () => ({ tools: [] }),
    } as never);
    const result = await adapter.discover('source', 'a'.repeat(64), context());
    expect(result).toMatchObject({
      metadata: {
        serverInfo: { name: 'fixture', version: '1.0.0' },
        serverCapabilities: { tools: {} },
        instructions: 'metadata only',
      },
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
    });
  });
});
