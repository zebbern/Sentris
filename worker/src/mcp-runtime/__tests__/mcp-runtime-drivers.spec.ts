import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { FetchLike } from '@modelcontextprotocol/client';
import type { McpRuntimeFence, McpRuntimeKey } from '@sentris/shared';

import { McpClientFactory } from '../mcp-client-factory';
import type { McpConnectionInput, McpOwnedClient } from '../mcp-client-adapter.types';
import { DockerRuntimeDriver } from '../drivers/docker-runtime.driver';
import { HostStdioRuntimeDriver } from '../drivers/host-stdio-runtime.driver';
import { RemoteHttpRuntimeDriver } from '../drivers/remote-http-runtime.driver';
import { startHttpFixture, STDIO_FIXTURE_SCRIPT } from './fixtures/mcp-conformance-servers';

const runtimeKey = (transport: McpRuntimeKey['transport']): McpRuntimeKey => ({
  sourceId: 'source-a',
  transport,
  configFingerprint: 'a'.repeat(64),
  organizationId: 'org-a',
  principalPartitionHash: 'b'.repeat(64),
  credentialReference: 'credential-a',
  credentialGeneration: 1,
});

const fence: McpRuntimeFence = {
  runtimeId: '11111111-1111-4111-8111-111111111111',
  ownerId: 'worker-a',
  ownerEpoch: '22222222-2222-4222-8222-222222222222',
  leaseGeneration: 7,
};

const HTTP_RUNTIME_KEY_HASH = '7ad795430da1b238fd97f0f9a7dd18b197f255a27f051c321367ec399967148c';

const RESOURCE_SCOPE = {
  deploymentId: 'deployment-a',
  instanceId: '5',
  temporalNamespace: 'sentris-dev-5',
  temporalTaskQueue: 'sentris-worker-5',
};

const RESOURCE_SCOPE_LABELS = {
  'sentris.deploymentId': RESOURCE_SCOPE.deploymentId,
  'sentris.instance': RESOURCE_SCOPE.instanceId,
  'sentris.temporalNamespace': RESOURCE_SCOPE.temporalNamespace,
  'sentris.temporalTaskQueue': RESOURCE_SCOPE.temporalTaskQueue,
};

const baseDefinition = {
  sourceId: 'source-a',
  configFingerprint: 'a'.repeat(64),
  bindingFingerprint: 'c'.repeat(64),
};

const startInput = <TDefinition>(
  definition: TDefinition,
  transport: McpRuntimeKey['transport'],
) => ({
  runtimeKey: runtimeKey(transport),
  fence,
  ownerAddress: 'http://worker-a.internal:9200',
  definition,
  signal: AbortSignal.timeout(5_000),
  connectTimeoutMs: 2_000,
});

describe('RemoteHttpRuntimeDriver', () => {
  test('injects the redirect-aware fetch into the canonical v2 factory', async () => {
    const fixture = await startHttpFixture();
    const factory = new McpClientFactory();
    let fetchCalls = 0;
    const driver = new RemoteHttpRuntimeDriver(factory, {
      fetch: async (request, init) => {
        fetchCalls += 1;
        return globalThis.fetch(request, init);
      },
    });
    let handle: Awaited<ReturnType<RemoteHttpRuntimeDriver['start']>> | undefined;
    try {
      handle = await driver.start(
        startInput(
          {
            ...baseDefinition,
            kind: 'remote-http' as const,
            endpoint: fixture.endpoint.href,
            allowedInternalHosts: ['127.0.0.1'],
          },
          'http',
        ),
      );
      expect(fetchCalls).toBeGreaterThan(0);
    } finally {
      await handle?.close();
      await fixture.close();
    }
  });

  test('validates every redirect hop, preserves redirect method rules, and strips cross-origin credentials', async () => {
    const factory = new CapturingFactory();
    const validated: string[] = [];
    const requests: {
      url: string;
      method: string;
      authorization: string | null;
      body: string;
    }[] = [];
    const responses = [
      new Response(null, { status: 307, headers: { location: '/same-origin' } }),
      new Response(null, {
        status: 307,
        headers: { location: 'http://93.184.216.35/cross-origin' },
      }),
      new Response(null, { status: 303, headers: { location: '/complete' } }),
      new Response('ok', { status: 200 }),
    ];
    const upstreamFetch: FetchLike = async (request, init) => {
      const captured = new Request(request.toString(), init);
      requests.push({
        url: captured.url,
        method: captured.method,
        authorization: captured.headers.get('authorization'),
        body: captured.method === 'GET' || captured.method === 'HEAD' ? '' : await captured.text(),
      });
      return responses.shift()!;
    };
    const driver = new RemoteHttpRuntimeDriver(factory, {
      fetch: upstreamFetch,
      validateUrl: async (url) => {
        validated.push(url);
      },
    });

    await driver.start(
      startInput(
        {
          ...baseDefinition,
          kind: 'remote-http' as const,
          endpoint: 'http://93.184.216.34/mcp',
        },
        'http',
      ),
    );
    const connection = factory.connections[0];
    if (!connection || connection.transport !== 'http' || !connection.fetch) {
      throw new Error('Expected an HTTP connection with an injected fetch');
    }

    const result = await connection.fetch('http://93.184.216.34/start', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        'content-type': 'text/plain',
      },
      body: 'payload',
    });

    expect(await result.text()).toBe('ok');
    expect(validated).toEqual([
      'http://93.184.216.34/start',
      'http://93.184.216.34/same-origin',
      'http://93.184.216.35/cross-origin',
      'http://93.184.216.35/complete',
    ]);
    expect(requests).toEqual([
      {
        url: 'http://93.184.216.34/start',
        method: 'POST',
        authorization: 'Bearer secret',
        body: 'payload',
      },
      {
        url: 'http://93.184.216.34/same-origin',
        method: 'POST',
        authorization: 'Bearer secret',
        body: 'payload',
      },
      {
        url: 'http://93.184.216.35/cross-origin',
        method: 'POST',
        authorization: null,
        body: 'payload',
      },
      {
        url: 'http://93.184.216.35/complete',
        method: 'GET',
        authorization: null,
        body: '',
      },
    ]);
  });

  test('blocks a redirected destination before sending the next request', async () => {
    const factory = new CapturingFactory();
    const fetched: string[] = [];
    const driver = new RemoteHttpRuntimeDriver(factory, {
      fetch: async (request) => {
        fetched.push(new Request(request.toString()).url);
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data' },
        });
      },
      validateUrl: async (url) => {
        if (url.includes('169.254.169.254')) throw new Error('SSRF blocked');
      },
    });
    await driver.start(
      startInput(
        {
          ...baseDefinition,
          kind: 'remote-http' as const,
          endpoint: 'http://93.184.216.34/mcp',
        },
        'http',
      ),
    );
    const connection = factory.connections[0];
    if (!connection || connection.transport !== 'http' || !connection.fetch) {
      throw new Error('Expected an HTTP connection with an injected fetch');
    }

    await expect(connection.fetch('http://93.184.216.34/mcp')).rejects.toThrow('SSRF blocked');
    expect(fetched).toEqual(['http://93.184.216.34/mcp']);
  });
});

describe('HostStdioRuntimeDriver', () => {
  test('uses the canonical factory stdio path with bounded explicit process settings', async () => {
    const factory = new CapturingFactory();
    const root = await mkdtemp(join(tmpdir(), 'sentris-mcp-host-'));
    try {
      const driver = new HostStdioRuntimeDriver(factory);
      await driver.start(
        startInput(
          {
            ...baseDefinition,
            kind: 'host-stdio' as const,
            command: process.execPath,
            args: ['-e', 'process.stdin.resume()'],
            cwd: root,
            allowedCwdRoots: [root],
            environment: { MCP_TOKEN: 'explicit-secret' },
          },
          'stdio',
        ),
      );

      expect(factory.connections).toHaveLength(1);
      expect(factory.connections[0]).toMatchObject({
        transport: 'stdio',
        command: process.execPath,
        args: ['-e', 'process.stdin.resume()'],
        cwd: root,
        env: { MCP_TOKEN: 'explicit-secret' },
      });
      expect(factory.connections[0]).not.toHaveProperty('shell');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects a canonical cwd that escapes its approved roots', async () => {
    const factory = new CapturingFactory();
    const root = await mkdtemp(join(tmpdir(), 'sentris-mcp-approved-'));
    try {
      const driver = new HostStdioRuntimeDriver(factory);
      await expect(
        driver.start(
          startInput(
            {
              ...baseDefinition,
              kind: 'host-stdio' as const,
              command: process.execPath,
              cwd: tmpdir(),
              allowedCwdRoots: [root],
            },
            'stdio',
          ),
        ),
      ).rejects.toThrow('approved root');
      expect(factory.connections).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('connects a real official stdio transport through the canonical factory', async () => {
    const factory = new McpClientFactory();
    const driver = new HostStdioRuntimeDriver(factory);
    const cwd = join(process.cwd(), 'worker');
    const input = startInput(
      {
        ...baseDefinition,
        kind: 'host-stdio' as const,
        command: process.execPath,
        args: ['-e', STDIO_FIXTURE_SCRIPT],
        cwd,
        allowedCwdRoots: [process.cwd()],
      },
      'stdio',
    );
    const handle = await driver.start(input);
    try {
      const discovery = await handle.adapter.discover('source-a', 'c'.repeat(64), {
        signal: AbortSignal.timeout(5_000),
        idleTimeoutMs: 2_000,
        maxTotalTimeoutMs: 5_000,
      });
      expect(discovery.tools.map((tool) => tool.canonicalName)).toEqual(['echo']);
    } finally {
      await handle.close();
    }
  });
});

describe('DockerRuntimeDriver', () => {
  test('starts Docker HTTP with exact fence labels and keeps secrets out of arguments', async () => {
    const factory = new CapturingFactory();
    const commands: DockerInvocation[] = [];
    const containerId = 'd'.repeat(64);
    const driver = new DockerRuntimeDriver(factory, {
      environment: { DOCKER_HOST: 'tcp://dind:2375', SENTRIS_DIND_HOST: 'dind' },
      resourceScope: RESOURCE_SCOPE,
      dockerCommand: async (args, options) => {
        commands.push({ args: [...args], env: { ...options.env } });
        if (args[0] === 'run') return { stdout: `${containerId}\n`, stderr: '' };
        if (args[0] === 'port') return { stdout: '0.0.0.0:32781\n:::32781\n', stderr: '' };
        return { stdout: '', stderr: '' };
      },
    });

    const handle = await driver.start(
      startInput(
        {
          ...baseDefinition,
          kind: 'docker-http' as const,
          image: 'example/mcp-server:1.2.3',
          command: ['serve'],
          environment: { MCP_TOKEN: 'super-secret-token' },
          network: 'sentris',
          containerPort: 8080,
          endpointPath: '/mcp',
        },
        'http',
      ),
    );

    const run = commands[0]!;
    expect(run.args).toContain('sentris.mcp.managed=true');
    expect(run.args).toContain(`sentris.mcp.runtime-key-hash=${HTTP_RUNTIME_KEY_HASH}`);
    expect(run.args).toContain(`sentris.mcp.runtime-id=${fence.runtimeId}`);
    expect(run.args).toContain(`sentris.mcp.owner-id=${fence.ownerId}`);
    expect(run.args).toContain(`sentris.mcp.owner-epoch=${fence.ownerEpoch}`);
    expect(run.args).toContain(`sentris.mcp.lease-generation=${fence.leaseGeneration}`);
    for (const [key, value] of Object.entries(RESOURCE_SCOPE_LABELS)) {
      expect(run.args).toContain(`${key}=${value}`);
    }
    expect(run.args).toContain('MCP_TOKEN');
    expect(run.args.join(' ')).not.toContain('super-secret-token');
    expect(run.env.MCP_TOKEN).toBe('super-secret-token');
    expect(factory.connections[0]).toMatchObject({
      transport: 'http',
      endpoint: new URL('http://dind:32781/mcp'),
    });
    expect(handle.resource).toEqual({
      kind: 'docker-container',
      resourceId: containerId,
      runtimeKeyHash: HTTP_RUNTIME_KEY_HASH,
      fence,
    });
  });

  test('removes a Docker HTTP container when MCP connect fails', async () => {
    const containerId = 'e'.repeat(64);
    const factory = new CapturingFactory(new Error('connect failed'));
    const commands: DockerInvocation[] = [];
    const driver = new DockerRuntimeDriver(factory, {
      dockerCommand: async (args, options) => {
        commands.push({ args: [...args], env: { ...options.env } });
        if (args[0] === 'run') return { stdout: containerId, stderr: '' };
        if (args[0] === 'port') return { stdout: '0.0.0.0:32782', stderr: '' };
        return { stdout: '', stderr: '' };
      },
    });

    await expect(
      driver.start(
        startInput(
          {
            ...baseDefinition,
            kind: 'docker-http' as const,
            image: 'example/mcp:latest',
            containerPort: 8080,
            dindHost: 'dind',
          },
          'http',
        ),
      ),
    ).rejects.toThrow('connect failed');

    expect(commands.some(({ args }) => args.join(' ') === `rm -f ${containerId}`)).toBe(true);
    expect(factory.closed).toEqual([runtimeKey('http')]);
  });

  test('runs Docker stdio through the official factory without deterministic names or secret args', async () => {
    const containerId = 'f'.repeat(64);
    const factory = new CapturingFactory();
    const driver = new DockerRuntimeDriver(factory, {
      dockerCommand: async (args) => ({
        stdout: args[0] === 'ps' ? containerId : '',
        stderr: '',
      }),
    });
    const handle = await driver.start(
      startInput(
        {
          ...baseDefinition,
          kind: 'docker-stdio' as const,
          image: 'example/mcp:latest',
          command: ['serve'],
          environment: { MCP_TOKEN: 'stdio-secret' },
        },
        'stdio',
      ),
    );
    const connection = factory.connections[0];
    if (!connection || connection.transport !== 'stdio') throw new Error('Expected stdio');

    expect(connection.command).toBe('docker');
    expect(connection.args).toContain('run');
    expect(connection.args).toContain('--rm');
    expect(connection.args).toContain('-i');
    expect(connection.args).not.toContain('--name');
    expect(connection.args).not.toContain('--cidfile');
    expect(connection.args!.join(' ')).not.toContain('stdio-secret');
    expect(connection.env?.MCP_TOKEN).toBe('stdio-secret');
    expect(handle.resource?.resourceId).toBe(containerId);
  });

  test('passes typed Docker stdio options as exact argv tokens', async () => {
    const containerId = '9'.repeat(64);
    const factory = new CapturingFactory();
    const driver = new DockerRuntimeDriver(factory, {
      dockerCommand: async (args) => ({
        stdout: args[0] === 'ps' ? containerId : '',
        stderr: '',
      }),
    });

    await driver.start(
      startInput(
        {
          ...baseDefinition,
          kind: 'docker-stdio' as const,
          image: 'example/mcp:latest',
          command: ['serve', '--verbose'],
          environment: { MCP_TOKEN: 'stdio-secret' },
          network: 'sentris',
          volumes: ['cache:/data:ro', 'C:\\Work Space:/workspace'],
          mounts: ['type=bind,src=/source path,dst=/workspace,readonly'],
          workingDirectory: '/workspace',
          user: '1000:1000',
          entrypoint: '',
          readOnlyRootFilesystem: true,
          init: true,
        },
        'stdio',
      ),
    );
    const connection = factory.connections[0];
    if (!connection || connection.transport !== 'stdio' || !connection.args) {
      throw new Error('Expected a Docker stdio connection');
    }
    const optionsStart = connection.args.indexOf('--network');
    const imageIndex = connection.args.indexOf('example/mcp:latest');

    expect(connection.args.slice(optionsStart, imageIndex)).toEqual([
      '--network',
      'sentris',
      '--env',
      'MCP_TOKEN',
      '--volume',
      'cache:/data:ro',
      '--volume',
      'C:\\Work Space:/workspace',
      '--mount',
      'type=bind,src=/source path,dst=/workspace,readonly',
      '--workdir',
      '/workspace',
      '--user',
      '1000:1000',
      '--entrypoint',
      '',
      '--read-only',
      '--init',
    ]);
    expect(connection.args.slice(imageIndex)).toEqual(['example/mcp:latest', 'serve', '--verbose']);
    expect(connection.args.join(' ')).not.toContain('stdio-secret');
    expect(connection.env?.MCP_TOKEN).toBe('stdio-secret');
  });

  test('deterministically truncates inventory with one overflow sentinel for reconciliation', async () => {
    const factory = new CapturingFactory();
    const ids = ['d'.repeat(64), 'b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64)];
    const commands: DockerInvocation[] = [];
    const driver = new DockerRuntimeDriver(factory, {
      maxInventory: 2,
      resourceScope: RESOURCE_SCOPE,
      dockerCommand: async (args, options) => {
        commands.push({ args: [...args], env: { ...options.env } });
        if (args[0] === 'ps') return { stdout: ids.join('\n'), stderr: '' };
        const id = args.at(-1)!;
        return {
          stdout: JSON.stringify({
            'sentris.mcp.managed': 'true',
            'sentris.mcp.runtime-key-hash': HTTP_RUNTIME_KEY_HASH,
            'sentris.mcp.runtime-id': fence.runtimeId,
            'sentris.mcp.owner-id': fence.ownerId,
            'sentris.mcp.owner-epoch': fence.ownerEpoch,
            'sentris.mcp.lease-generation': String(fence.leaseGeneration),
            ...RESOURCE_SCOPE_LABELS,
          }),
          stderr: id,
        };
      },
    });

    await expect(driver.inventory()).resolves.toEqual(
      ['a', 'b', 'c'].map((prefix) => expect.objectContaining({ resourceId: prefix.repeat(64) })),
    );
    expect(commands).toHaveLength(4);
    expect(commands[0]!.args).toEqual([
      'ps',
      '-aq',
      '--filter',
      'label=sentris.mcp.managed=true',
      '--filter',
      'label=sentris.deploymentId=deployment-a',
      '--filter',
      'label=sentris.instance=5',
      '--filter',
      'label=sentris.temporalNamespace=sentris-dev-5',
      '--filter',
      'label=sentris.temporalTaskQueue=sentris-worker-5',
    ]);
    expect(commands.slice(1).map(({ args }) => args.at(-1))).toEqual(
      ['a', 'b', 'c'].map((prefix) => prefix.repeat(64)),
    );
  });

  test('ignores a foreign deployment resource even if Docker returns it from inventory', async () => {
    const localId = 'a'.repeat(64);
    const foreignId = 'b'.repeat(64);
    const driver = new DockerRuntimeDriver(new CapturingFactory(), {
      resourceScope: RESOURCE_SCOPE,
      dockerCommand: async (args) => {
        if (args[0] === 'ps') return { stdout: `${localId}\n${foreignId}\n`, stderr: '' };
        const id = args.at(-1)!;
        return {
          stdout: JSON.stringify({
            'sentris.mcp.managed': 'true',
            'sentris.mcp.runtime-key-hash': HTTP_RUNTIME_KEY_HASH,
            'sentris.mcp.runtime-id': fence.runtimeId,
            'sentris.mcp.owner-id': fence.ownerId,
            'sentris.mcp.owner-epoch': fence.ownerEpoch,
            'sentris.mcp.lease-generation': String(fence.leaseGeneration),
            ...RESOURCE_SCOPE_LABELS,
            ...(id === foreignId ? { 'sentris.instance': '6' } : {}),
          }),
          stderr: '',
        };
      },
    });

    await expect(driver.inventory()).resolves.toEqual([
      expect.objectContaining({ resourceId: localId }),
    ]);
  });

  test('rejects an invalid deployment scope before issuing Docker commands', () => {
    expect(
      () =>
        new DockerRuntimeDriver(new CapturingFactory(), {
          resourceScope: { ...RESOURCE_SCOPE, deploymentId: 'deployment-a\nforeign' },
        }),
    ).toThrow('deploymentId');
  });
});

interface DockerInvocation {
  args: string[];
  env: Record<string, string>;
}

class CapturingFactory implements Pick<McpClientFactory, 'connect' | 'close'> {
  readonly connections: McpConnectionInput[] = [];
  readonly closed: McpRuntimeKey[] = [];

  constructor(
    private readonly connectionError?: Error,
    private readonly beforeConnect?: (connection: McpConnectionInput) => Promise<void>,
  ) {}

  async connect(connection: McpConnectionInput): Promise<McpOwnedClient> {
    this.connections.push(connection);
    await this.beforeConnect?.(connection);
    if (this.connectionError) throw this.connectionError;
    return {
      runtimeKey: connection.runtimeKey,
      cachePartition: 'test',
      cacheStore: {} as McpOwnedClient['cacheStore'],
      adapter: {} as McpOwnedClient['adapter'],
    };
  }

  async close(key: McpRuntimeKey): Promise<void> {
    this.closed.push(key);
  }
}
