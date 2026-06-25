import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import type { ExecutionContext } from '@sentris/component-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

export const MCP_STDIO_HOST_PROXY_ID_PREFIX = 'host-mcp-proxy-';

interface StartMcpStdioHostProxyInput {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  context?: ExecutionContext;
}

interface StartMcpStdioHostProxyOutput {
  endpoint: string;
  containerId: string;
}

interface RunningHostProxy {
  client: Client;
  server: Server;
  endpoint: string;
}

const runningHostProxies = new Map<string, RunningHostProxy>();

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
        } else {
          resolve(port);
        }
      });
    });
  });
}

function normalizeProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  return env;
}

function isDockerCommand(command: string): boolean {
  const executable = command.replace(/\\/g, '/').split('/').pop()?.toLowerCase();
  return executable === 'docker' || executable === 'docker.exe';
}

function dockerEnvKey(raw: string): string {
  return raw.split('=')[0].trim();
}

function getExistingDockerEnvKeys(args: string[]): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-e' || arg === '--env') && args[i + 1]) {
      keys.add(dockerEnvKey(args[i + 1]));
      i += 1;
      continue;
    }
    if (arg.startsWith('--env=')) {
      keys.add(dockerEnvKey(arg.slice('--env='.length)));
    }
  }
  return keys;
}

function withDockerEnvPassthrough(
  command: string,
  args: string[],
  env: Record<string, string>,
): string[] {
  if (!isDockerCommand(command) || args[0] !== 'run' || Object.keys(env).length === 0) {
    return args;
  }

  const existingKeys = getExistingDockerEnvKeys(args);
  const passthroughArgs = Object.keys(env)
    .filter((key) => !existingKeys.has(key))
    .flatMap((key) => ['-e', key]);

  return ['run', ...passthroughArgs, ...args.slice(1)];
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > 2 * 1024 * 1024) {
      throw new Error('Request body too large');
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return null;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleJsonRpc(
  body: any,
  client: Client,
  name: string,
): Promise<{ status: number; body?: unknown }> {
  if (body && body.method && body.id === undefined) {
    return { status: 202 };
  }

  if (!body || !body.method) {
    return {
      status: 400,
      body: {
        jsonrpc: '2.0',
        id: body?.id ?? null,
        error: { code: -32600, message: 'Invalid request: missing method' },
      },
    };
  }

  try {
    switch (body.method) {
      case 'initialize': {
        const capabilities = (client as any).getServerCapabilities?.() ?? {
          tools: { listChanged: false },
        };
        const serverInfo = (client as any).getServerVersion?.() ?? {
          name: `mcp-host-proxy-${name}`,
          version: '1.0.0',
        };
        const instructions = (client as any).getInstructions?.();
        return {
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: LATEST_PROTOCOL_VERSION,
              capabilities,
              serverInfo,
              instructions,
            },
          },
        };
      }

      case 'tools/list':
        return {
          status: 200,
          body: { jsonrpc: '2.0', id: body.id, result: await client.listTools() },
        };

      case 'tools/call':
        return {
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: body.id,
            result: await client.callTool({
              name: body.params.name,
              arguments: body.params.arguments ?? {},
            }),
          },
        };

      case 'resources/list':
        return {
          status: 200,
          body: { jsonrpc: '2.0', id: body.id, result: await client.listResources() },
        };

      case 'resources/read':
        return {
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: body.id,
            result: await client.readResource({ uri: body.params.uri }),
          },
        };

      case 'prompts/list':
        return {
          status: 200,
          body: { jsonrpc: '2.0', id: body.id, result: await client.listPrompts() },
        };

      case 'prompts/get':
        return {
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: body.id,
            result: await client.getPrompt({
              name: body.params.name,
              arguments: body.params.arguments ?? {},
            }),
          },
        };

      default:
        return {
          status: 400,
          body: {
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -32601, message: `Method not found: ${body.method}` },
          },
        };
    }
  } catch (error: unknown) {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

export async function startMcpStdioHostProxy(
  input: StartMcpStdioHostProxyInput,
): Promise<StartMcpStdioHostProxyOutput> {
  const command = input.command.trim();
  if (!command) {
    throw new Error('command is required for stdio MCP host proxy');
  }

  const env = input.env ?? {};
  const args = withDockerEnvPassthrough(command, input.args ?? [], env);
  const childEnv = { ...normalizeProcessEnv(), ...env };
  const id = `${MCP_STDIO_HOST_PROXY_ID_PREFIX}${randomUUID()}`;
  const port = await getAvailablePort();
  const endpoint = `http://localhost:${port}/mcp`;
  const client = new Client({ name: 'sentris-mcp-stdio-host-proxy', version: '1.0.0' });
  const transport = new StdioClientTransport({ command, args, env: childEnv });

  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        mode: 'host-stdio',
        servers: [{ name: 'default', ready: true }],
      });
      return;
    }

    if (url.pathname !== '/mcp') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'use POST for MCP JSON-RPC requests' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const result = await handleJsonRpc(body, client, 'default');
      if (result.status === 202) {
        res.writeHead(202);
        res.end();
        return;
      }
      sendJson(res, result.status, result.body);
    } catch (error: unknown) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  try {
    await listen(server, port);
  } catch (error) {
    await client.close().catch(() => {});
    server.close();
    throw error;
  }

  runningHostProxies.set(id, { client, server, endpoint });
  input.context?.logger.info(`[MCP Host Proxy] Started ${id} at ${endpoint}`);
  return { endpoint, containerId: id };
}

export function isMcpStdioHostProxyId(containerId: string): boolean {
  return containerId.startsWith(MCP_STDIO_HOST_PROXY_ID_PREFIX);
}

export async function stopMcpStdioHostProxy(containerId: string): Promise<boolean> {
  const running = runningHostProxies.get(containerId);
  if (!running) {
    return false;
  }

  runningHostProxies.delete(containerId);
  await Promise.allSettled([
    running.client.close(),
    new Promise<void>((resolve) => running.server.close(() => resolve())),
  ]);
  return true;
}
