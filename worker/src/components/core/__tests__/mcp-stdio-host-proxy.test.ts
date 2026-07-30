import { afterEach, beforeAll, describe, expect, mock, test, vi } from 'bun:test';

const connect = vi.fn(async () => undefined);
const close = vi.fn(async () => undefined);
const transportInputs: { command: string; args: string[]; env: Record<string, string> }[] = [];

class MockClient {
  connect = connect;
  close = close;
}

class MockStdioClientTransport {
  constructor(input: { command: string; args: string[]; env: Record<string, string> }) {
    transportInputs.push(input);
  }
}

mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }));
mock.module('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: MockStdioClientTransport,
}));

let startMcpStdioHostProxy: typeof import('../mcp-stdio-host-proxy').startMcpStdioHostProxy;
let stopMcpStdioHostProxy: typeof import('../mcp-stdio-host-proxy').stopMcpStdioHostProxy;
const originalSecret = process.env.SECRET_STORE_MASTER_KEY;
const originalInternalToken = process.env.INTERNAL_SERVICE_TOKEN;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalPath = process.env.Path;
const originalPathExt = process.env.PATHEXT;

describe('startMcpStdioHostProxy', () => {
  beforeAll(async () => {
    // Bun module mocks are process-wide and another MCP integration suite
    // intentionally replaces this module. A query-qualified import gives this
    // behavior test its own real module instance regardless of file order.
    const realModulePath = '../mcp-stdio-host-proxy.ts?host-proxy-behavior-test';
    ({ startMcpStdioHostProxy, stopMcpStdioHostProxy } = (await import(
      realModulePath
    )) as typeof import('../mcp-stdio-host-proxy'));
  });

  afterEach(() => {
    transportInputs.length = 0;
    vi.clearAllMocks();
    if (originalSecret === undefined) {
      delete process.env.SECRET_STORE_MASTER_KEY;
    } else {
      process.env.SECRET_STORE_MASTER_KEY = originalSecret;
    }
    if (originalInternalToken === undefined) {
      delete process.env.INTERNAL_SERVICE_TOKEN;
    } else {
      process.env.INTERNAL_SERVICE_TOKEN = originalInternalToken;
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalPath === undefined) {
      delete process.env.Path;
    } else {
      process.env.Path = originalPath;
    }
    if (originalPathExt === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = originalPathExt;
    }
  });

  test('does not expose the worker environment to a trusted-local stdio child process', async () => {
    process.env.SECRET_STORE_MASTER_KEY = 'worker-secret';
    process.env.INTERNAL_SERVICE_TOKEN = 'worker-internal-token';
    process.env.DATABASE_URL = 'postgresql://worker-only';
    const proxy = await startMcpStdioHostProxy({
      command: 'trusted-mcp-server',
      args: ['--serve'],
      env: { MCP_SERVER_TOKEN: 'explicit-token' },
    });

    expect(transportInputs).toHaveLength(1);
    expect(transportInputs[0].env).toMatchObject({ MCP_SERVER_TOKEN: 'explicit-token' });
    expect(transportInputs[0].env.SECRET_STORE_MASTER_KEY).toBeUndefined();
    expect(transportInputs[0].env.INTERNAL_SERVICE_TOKEN).toBeUndefined();
    expect(transportInputs[0].env.DATABASE_URL).toBeUndefined();

    await stopMcpStdioHostProxy(proxy.proxyId);
  });

  test('preserves Windows command-resolution variables without inheriting worker secrets', async () => {
    process.env.Path = 'C:\\Windows\\System32';
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    process.env.SECRET_STORE_MASTER_KEY = 'worker-secret';

    const proxy = await startMcpStdioHostProxy({ command: 'trusted-mcp-server.cmd' });

    expect(transportInputs[0].env.Path).toBe('C:\\Windows\\System32');
    expect(transportInputs[0].env.PATHEXT).toBe('.COM;.EXE;.BAT;.CMD');
    expect(transportInputs[0].env.SECRET_STORE_MASTER_KEY).toBeUndefined();

    await stopMcpStdioHostProxy(proxy.proxyId);
  });

  test('binds the host proxy to a worker-reachable loopback endpoint', async () => {
    const proxy = await startMcpStdioHostProxy({ command: 'trusted-mcp-server' });

    try {
      expect(proxy).toMatchObject({ proxyId: expect.stringMatching(/^host-mcp-proxy-/) });
      expect(new URL(proxy.endpoint).hostname).toBe('127.0.0.1');
      const response = await fetch(proxy.endpoint.replace('/mcp', '/health'));
      expect(response.ok).toBe(true);
      expect(await response.json()).toMatchObject({
        status: 'ok',
        mode: 'same-worker-loopback-stdio',
      });
    } finally {
      await stopMcpStdioHostProxy(proxy.proxyId);
    }
  });
});
