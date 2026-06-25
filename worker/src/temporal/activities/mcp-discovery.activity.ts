import { startMcpDockerServer } from '../../components/core/mcp-runtime';
import {
  isMcpStdioHostProxyId,
  startMcpStdioHostProxy,
  stopMcpStdioHostProxy,
} from '../../components/core/mcp-stdio-host-proxy';
import { Context } from '@temporalio/activity';
import { createExecutionContext, type LogEventInput } from '@sentris/component-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  DiscoveryActivityInput,
  DiscoveryActivityOutput,
  GroupDiscoveryActivityInput,
  GroupDiscoveryActivityOutput,
  GroupDiscoveryActivityResult,
  McpTool,
} from '../types';
import { workflowDiagnosticLog } from '../workflow-diagnostics';
import Redis from 'ioredis';

// Initialize Redis for caching
const redisUrl =
  process.env.REDIS_URL || process.env.TERMINAL_REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

function logMcpDiscoveryEntry(prefix: string, entry: LogEventInput): void {
  const message = `[${prefix}] ${entry.message}`;
  if (entry.level === 'error') {
    console.error(message);
    return;
  }
  if (entry.level === 'warn') {
    console.warn(message);
    return;
  }
  workflowDiagnosticLog(message);
}

/**
 * Cache discovery results in Redis
 */
export async function cacheDiscoveryResultActivity(input: {
  cacheToken: string;
  tools: McpTool[];
  workflowId: string;
}): Promise<void> {
  const key = `mcp-discovery:${input.cacheToken}`;
  const value = JSON.stringify({
    status: 'completed',
    workflowId: input.workflowId,
    tools: input.tools,
    toolCount: input.tools.length,
    cachedAt: new Date().toISOString(),
  });
  await redis.setex(key, 300, value); // 5 minutes TTL
  workflowDiagnosticLog(
    `[MCP Discovery] Cached discovery results: ${input.tools.length} tools for token ${input.cacheToken}`,
  );
}

/**
 * Retrieve cached discovery results from Redis
 */
export async function getCachedDiscoveryActivity(input: {
  cacheToken: string;
}): Promise<{ tools: McpTool[]; toolCount: number } | null> {
  const key = `mcp-discovery:${input.cacheToken}`;
  const value = await redis.get(key);
  if (!value) {
    return null;
  }
  const cached = JSON.parse(value);
  if (cached.status !== 'completed') {
    return null;
  }
  return {
    tools: cached.tools,
    toolCount: cached.toolCount,
  };
}

/**
 * Main discovery activity for MCP servers.
 * Supports both HTTP (direct connection) and STDIO (Docker container) transports.
 *
 * For STDIO transport:
 * - Spawns a Docker container using the stdio-proxy image
 * - Waits for the container to be ready
 * - Discovers tools via MCP protocol
 * - Cleans up the container in finally block
 *
 * For HTTP transport:
 * - Connects directly to the endpoint
 * - Tests connection with initialize
 * - Discovers tools via MCP protocol
 */
export async function discoverMcpToolsActivity(
  input: DiscoveryActivityInput,
): Promise<DiscoveryActivityOutput> {
  const ctx = Context.current();
  let containerId: string | undefined;

  try {
    let endpoint: string;

    // HTTP: direct connection
    if (input.transport === 'http') {
      if (!input.endpoint) {
        throw new Error('endpoint is required for http transport');
      }
      endpoint = input.endpoint;
      ctx.heartbeat('http-endpoint-ready');
    }
    // STDIO: spawn Docker container
    else if (input.transport === 'stdio') {
      if (!input.command) {
        throw new Error('command is required for stdio transport');
      }
      const result = await spawnStdioContainer({
        command: input.command,
        args: input.args || [],
        image: input.image,
      });
      containerId = result.containerId;
      if (!containerId) {
        throw new Error('Container ID is required for STDIO transport');
      }
      endpoint = result.endpoint;
      ctx.heartbeat('container-spawned');
      // Wait for container to be ready with health check
      await waitForContainerReady(endpoint);
      ctx.heartbeat('container-ready');
    } else {
      throw new Error(`Unsupported transport: ${(input as any).transport}`);
    }

    // Discover tools
    const tools = await discoverMcpToolsFromEndpoint(endpoint, input.headers);
    ctx.heartbeat('tools-discovered');
    return { tools };
  } finally {
    // Always cleanup
    if (containerId) {
      await cleanupContainer(containerId);
    }
  }
}

/**
 * Group discovery activity for MCP servers.
 * Uses a single stdio proxy container with named servers for all stdio configs.
 */
export async function discoverMcpGroupToolsActivity(
  input: GroupDiscoveryActivityInput,
): Promise<GroupDiscoveryActivityOutput> {
  const ctx = Context.current();
  let containerId: string | undefined;
  let baseEndpoint: string | undefined;

  try {
    const stdioServers = input.servers.filter((server) => server.transport === 'stdio');
    const httpServers = input.servers.filter((server) => server.transport === 'http');

    if (stdioServers.length > 0) {
      const spawn = await spawnNamedServersContainer({
        servers: stdioServers,
        image: input.image,
      });
      containerId = spawn.containerId;
      baseEndpoint = spawn.baseEndpoint;
      ctx.heartbeat('container-spawned');
      await waitForContainerReady(`${baseEndpoint}/health`);
      ctx.heartbeat('container-ready');
    }

    const results: GroupDiscoveryActivityResult[] = [];

    for (const server of httpServers) {
      try {
        if (!server.endpoint) {
          throw new Error('endpoint is required for http transport');
        }
        const tools = await discoverMcpToolsFromEndpoint(server.endpoint, server.headers);
        results.push({ name: server.name, tools });
        ctx.heartbeat(`http-discovered:${server.name}`);
      } catch (error: unknown) {
        results.push({
          name: server.name,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const server of stdioServers) {
      try {
        if (!baseEndpoint) {
          throw new Error('stdio proxy endpoint not available');
        }
        const endpoint = `${baseEndpoint}/servers/${encodeURIComponent(server.name)}/sse`;
        await waitForContainerReady(`${baseEndpoint}/health`);
        const tools = await discoverMcpToolsFromEndpoint(endpoint, server.headers);
        results.push({ name: server.name, tools });
        ctx.heartbeat(`stdio-discovered:${server.name}`);
      } catch (error: unknown) {
        results.push({
          name: server.name,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { results };
  } finally {
    if (containerId) {
      await cleanupContainer(containerId);
    }
  }
}

/**
 * Spawn stdio container using existing mcp-runtime.ts
 */
async function spawnStdioContainer(input: {
  command: string;
  args: string[];
  image?: string;
}): Promise<{ containerId: string; endpoint: string }> {
  // Create minimal execution context for Docker runner
  const context = createExecutionContext({
    runId: `mcp-discovery-${Date.now()}`,
    componentRef: 'mcp-discovery',
    logCollector: (entry) => {
      logMcpDiscoveryEntry('MCP Discovery', entry);
    },
  });

  const { awsEnv, volumes } = getAwsConfig();

  void input.image;
  void volumes;

  const result = await startMcpStdioHostProxy({
    command: input.command,
    args: input.args,
    env: awsEnv,
    context,
  });

  // containerId should always be set for Docker containers
  const containerId = result.containerId;
  if (!containerId) {
    throw new Error('Docker container ID not returned from startMcpDockerServer');
  }

  return {
    containerId,
    endpoint: result.endpoint,
  };
}

async function spawnNamedServersContainer(input: {
  servers: { name: string; command?: string; args?: string[] }[];
  image?: string;
}): Promise<{ containerId: string; baseEndpoint: string }> {
  const context = createExecutionContext({
    runId: `mcp-group-discovery-${Date.now()}`,
    componentRef: 'mcp-group-discovery',
    logCollector: (entry) => {
      logMcpDiscoveryEntry('MCP Group Discovery', entry);
    },
  });

  const { awsEnv, volumes } = getAwsConfig();

  const namedServers: Record<string, { command: string; args?: string[] }> = {};
  for (const server of input.servers) {
    if (!server.command) {
      throw new Error(`command is required for stdio server '${server.name}'`);
    }
    namedServers[server.name] = {
      command: server.command,
      args: server.args ?? [],
    };
  }

  const result = await startMcpDockerServer({
    image: input.image || 'zebbern/mcp-stdio-proxy:latest',
    command: [],
    env: {
      MCP_NAMED_SERVERS: JSON.stringify({ mcpServers: namedServers }),
      ...awsEnv,
    },
    volumes: volumes.length > 0 ? volumes : undefined,
    port: 0,
    autoRemove: true,
    params: {},
    context,
  });

  const containerId = result.containerId;
  if (!containerId) {
    throw new Error('Docker container ID not returned from startMcpDockerServer');
  }

  const baseEndpoint = result.endpoint.replace(/\/mcp$/, '');
  return { containerId, baseEndpoint };
}

function getAwsConfig(): {
  awsEnv: Record<string, string>;
  volumes: { source: string; target: string; readOnly?: boolean }[];
} {
  const awsEnv: Record<string, string> = {};
  const passThroughEnv = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_REGION',
    'AWS_DEFAULT_REGION',
    'AWS_PROFILE',
  ];
  for (const key of passThroughEnv) {
    const value = process.env[key];
    if (value) {
      awsEnv[key] = value;
    }
  }

  const home = homedir();
  const awsCredentials = join(home, '.aws', 'credentials');
  const awsConfig = join(home, '.aws', 'config');
  const volumes = [];
  if (existsSync(awsCredentials)) {
    volumes.push({ source: awsCredentials, target: '/root/.aws/credentials', readOnly: true });
  }
  if (existsSync(awsConfig)) {
    volumes.push({ source: awsConfig, target: '/root/.aws/config', readOnly: true });
  }

  return { awsEnv, volumes };
}

async function discoverMcpToolsFromEndpoint(
  endpoint: string,
  headers?: Record<string, string>,
): Promise<McpTool[]> {
  let client: Client | null = null;

  try {
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: {
        headers: {
          Accept: 'application/json, text/event-stream',
          ...(headers || {}),
        },
      },
    });

    client = new Client(
      { name: 'sentris-worker-mcp-discovery', version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);
    const result = await client.listTools();

    return (result.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
    }));
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

/**
 * Wait for container to be ready using health check
 * Waits for both HTTP server and STDIO MCP client to be ready
 */
async function waitForContainerReady(endpoint: string): Promise<void> {
  const healthUrl = endpoint.includes('/health') ? endpoint : endpoint.replace('/mcp', '/health');
  const maxAttempts = 60; // 60 seconds total (STDIO connection can take time)
  const pollInterval = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(healthUrl, { method: 'GET' });
      if (response.ok) {
        const data = (await response.json()) as {
          status?: string;
          servers?: { ready: boolean }[];
        };
        if (data.status === 'ok') {
          // Check if the MCP server is actually ready (STDIO client connected)
          const servers = data.servers ?? [];
          const allReady = servers.every((s) => s.ready);
          if (servers.length > 0 && allReady) {
            workflowDiagnosticLog(
              `[MCP Discovery] Container ready after ${attempt + 1}s (${servers.length} server(s) ready)`,
            );
            return;
          }
          // HTTP is up but waiting for STDIO client connection
          if (attempt % 10 === 0) {
            workflowDiagnosticLog(
              `[MCP Discovery] HTTP ready, waiting for STDIO client... (${servers.filter((s) => s.ready).length}/${servers.length} ready)`,
            );
          }
        }
      }
    } catch {
      // Not ready yet, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error('Container failed to become ready after 60 seconds');
}

/**
 * Cleanup container using docker CLI
 */
async function cleanupContainer(containerId: string | undefined): Promise<void> {
  if (!containerId) {
    return;
  }
  if (isMcpStdioHostProxyId(containerId)) {
    await stopMcpStdioHostProxy(containerId);
    return;
  }
  // Validate container ID to prevent command injection
  if (!/^[a-zA-Z0-9_.-][a-zA-Z0-9_.-]*$/.test(containerId)) {
    console.warn(`[MCP Discovery] Skipping cleanup with unsafe container id: ${containerId}`);
    return;
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    await execFileAsync('docker', ['rm', '-f', containerId]);
  } catch (error: unknown) {
    console.error(`[MCP Discovery] Failed to cleanup container ${containerId}:`, error);
  }
}
