import { describe, it, expect, beforeAll, afterAll, vi } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AuthService } from '../../auth/auth.service';
import { AuthGuard } from '../../auth/auth.guard';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { SecretsEncryptionService } from '../../secrets/secrets.encryption';
import { integrationsEnvConfig } from '../../config/integrations.config';
import { InternalMcpController } from '../internal-mcp.controller';
import { McpGatewayService } from '../mcp-gateway.service';
import { McpAuthService } from '../mcp-auth.service';
import { McpGroupsService } from '../../mcp-groups/mcp-groups.service';
import { ToolRegistryService, TOOL_REGISTRY_REDIS } from '../tool-registry.service';

// Simple Mock Redis
class MockRedis {
  data = new Map<string, Map<string, string>>();
  kv = new Map<string, string>();
  async hset(key: string, field: string, value: string) {
    if (!this.data.has(key)) this.data.set(key, new Map());
    this.data.get(key)!.set(field, value);
    return 1;
  }
  async hget(key: string, field: string) {
    return this.data.get(key)?.get(field) || null;
  }
  async hgetall(key: string) {
    return Object.fromEntries(this.data.get(key) ?? []);
  }
  async expire() {
    return 1;
  }
  async get(key: string) {
    return this.kv.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.kv.set(key, value);
    return 'OK';
  }
  async del(key: string) {
    const removedHash = this.data.delete(key);
    const removedValue = this.kv.delete(key);
    return removedHash || removedValue ? 1 : 0;
  }
  async quit() {}
}

describe('MCP Internal API (Integration)', () => {
  let app: INestApplication;
  let redis: MockRedis;
  let controller: InternalMcpController;
  let toolRegistryService: ToolRegistryService;
  const generateSessionToken = vi.fn(async () => 'mock-token');
  const cleanedGatewayRuns: string[] = [];
  const INTERNAL_TOKEN = 'test-internal-token';

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_TOKEN = INTERNAL_TOKEN;
    process.env.NODE_ENV = 'test';
    process.env.SKIP_INGEST_SERVICES = 'true';
    process.env.SENTRIS_SKIP_MIGRATION_CHECK = 'true';
    process.env.SECRET_STORE_MASTER_KEY = '0123456789abcdef0123456789abcdef';

    const mockRedis = new MockRedis();
    const encryption = new SecretsEncryptionService({
      get: (key: string) => {
        if (key === 'secrets') return { masterKey: process.env.SECRET_STORE_MASTER_KEY };
        return undefined;
      },
    } as any);
    toolRegistryService = new ToolRegistryService(mockRedis as unknown as any, encryption);

    // Register InternalMcpController directly with mock providers
    // instead of importing McpModule (which cascades into dozens of modules).
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [integrationsEnvConfig],
        }),
      ],
      controllers: [InternalMcpController],
      providers: [
        { provide: ToolRegistryService, useValue: toolRegistryService },
        {
          provide: McpGatewayService,
          useValue: {
            cleanupRun: async (runId: string) => {
              cleanedGatewayRuns.push(runId);
            },
          },
        },
        { provide: McpAuthService, useValue: { generateSessionToken } },
        {
          provide: McpGroupsService,
          useValue: { getServerConfig: async () => ({}) },
        },
        { provide: TOOL_REGISTRY_REDIS, useValue: mockRedis },
        {
          provide: AuthService,
          useValue: {
            authenticate: async () => {
              throw new ForbiddenException('Unauthorized');
            },
            providerName: 'local',
          },
        },
        {
          provide: ApiKeysService,
          useValue: { validateKey: async () => null },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    const authService = moduleFixture.get(AuthService);
    const apiKeysService = moduleFixture.get(ApiKeysService);
    const reflector = moduleFixture.get(Reflector);
    const configService = moduleFixture.get(ConfigService);
    app.useGlobalGuards(new AuthGuard(authService, apiKeysService, reflector, configService));
    await app.init();

    // Manually assign services to controller — NestJS DI may not inject
    // useValue providers into controllers compiled with Bun's TS compiler.
    controller = moduleFixture.get(InternalMcpController);
    (controller as unknown as { toolRegistry: ToolRegistryService }).toolRegistry =
      toolRegistryService;
    (
      controller as unknown as {
        mcpAuthService: { generateSessionToken: typeof generateSessionToken };
      }
    ).mcpAuthService = { generateSessionToken };
    (
      controller as unknown as {
        mcpGatewayService: { cleanupRun: (runId: string) => Promise<void> };
      }
    ).mcpGatewayService = {
      cleanupRun: async (runId: string) => {
        cleanedGatewayRuns.push(runId);
      },
    };

    redis = moduleFixture.get(TOOL_REGISTRY_REDIS);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('registers a component tool via internal API', async () => {
    const payload = {
      runId: 'run-test-1',
      nodeId: 'node-test-1',
      toolName: 'test_tool',
      componentId: 'core.test',
      description: 'Test Tool',
      inputSchema: { type: 'object', properties: {} },
      credentials: { apiKey: 'secret' },
    };

    const response = await request(app.getHttpServer())
      .post('/internal/mcp/register-component')
      .set('x-internal-token', INTERNAL_TOKEN)
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true });

    // Verify it's in Redis
    const toolJson = await redis.hget('mcp:run:run-test-1:tools', 'node-test-1');
    expect(toolJson).not.toBeNull();
    const tool = JSON.parse(toolJson!);
    expect(tool.toolName).toBe('test_tool');
    expect(tool.status).toBe('ready');
  });

  it('forwards requested token TTL to the auth service', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/mcp/generate-token')
      .set('x-internal-token', INTERNAL_TOKEN)
      .send({
        runId: 'run-token-ttl',
        organizationId: 'org-token-ttl',
        agentId: 'agent-token-ttl',
        allowedNodeIds: ['tool-a'],
        ttlSeconds: 900,
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ token: 'mock-token' });
    expect(generateSessionToken).toHaveBeenLastCalledWith(
      'run-token-ttl',
      'org-token-ttl',
      'agent-token-ttl',
      ['tool-a'],
      900,
    );
  });

  it('registers an MCP server with pre-discovered tools', async () => {
    const payload = {
      runId: 'run-test-2',
      nodeId: 'mcp-library-test',
      serverName: 'Test MCP Server',
      transport: 'http',
      endpoint: 'http://localhost:9999/mcp',
      tools: [
        {
          name: 'search',
          title: 'Search documents',
          description: 'Search documents',
          inputSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { query: { type: 'string' } },
            unevaluatedProperties: false,
          },
          outputSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { matches: { type: 'array', items: { type: 'string' } } },
          },
          icons: [{ src: 'https://example.test/search.svg', mimeType: 'image/svg+xml' }],
          annotations: { readOnlyHint: true },
          _meta: { 'com.example/source': 'worker-discovery' },
        },
        {
          name: 'analyze',
          description: 'Analyze data',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post('/internal/mcp/register-mcp-server')
      .set('x-internal-token', INTERNAL_TOKEN)
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true, toolCount: 2 });

    // Verify server is in Redis
    const serverJson = await redis.hget('mcp:run:run-test-2:tools', 'mcp-library-test');
    expect(serverJson).not.toBeNull();
    const server = JSON.parse(serverJson!);
    expect(server.toolName).toBe('Test MCP Server');
    expect(server.endpoint).toBe('http://localhost:9999/mcp');
    expect(server.status).toBe('ready');

    // Verify pre-discovered tools are stored
    const toolsJson = await redis.get('mcp:run:run-test-2:server:mcp-library-test:tools');
    expect(toolsJson).not.toBeNull();
    const tools = JSON.parse(toolsJson!);
    expect(tools.length).toBe(2);
    expect(tools[0]).toEqual({
      name: 'search',
      title: 'Search documents',
      description: 'Search documents',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { query: { type: 'string' } },
        unevaluatedProperties: false,
      },
      outputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { matches: { type: 'array', items: { type: 'string' } } },
      },
      icons: [{ src: 'https://example.test/search.svg', mimeType: 'image/svg+xml' }],
      annotations: { readOnlyHint: true },
      _meta: { 'com.example/source': 'worker-discovery' },
    });
  });

  it('cleans registry state and the outbound gateway pool for a run', async () => {
    await request(app.getHttpServer())
      .post('/internal/mcp/register-mcp-server')
      .set('x-internal-token', INTERNAL_TOKEN)
      .send({
        runId: 'run-cleanup',
        nodeId: 'mcp-cleanup',
        serverName: 'Cleanup MCP Server',
        transport: 'stdio',
        endpoint: 'http://localhost:9999/mcp',
        containerId: 'container-cleanup',
        tools: [{ name: 'search' }],
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/internal/mcp/cleanup')
      .set('x-internal-token', INTERNAL_TOKEN)
      .send({ runId: 'run-cleanup' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ containerIds: ['container-cleanup'] });
    expect(await redis.hget('mcp:run:run-cleanup:tools', 'mcp-cleanup')).toBeNull();
    expect(cleanedGatewayRuns).toEqual(['run-cleanup']);
  });

  it('awaits gateway cleanup before returning a registry cleanup error', async () => {
    const registryError = new Error('registry cleanup failed');
    const cleanupEvents: string[] = [];
    const failingRegistry = {
      cleanupRun: async () => {
        cleanupEvents.push('registry-failed');
        throw registryError;
      },
    };
    const delayedGateway = {
      cleanupRun: async () => {
        cleanupEvents.push('gateway-started');
        await new Promise((resolve) => setTimeout(resolve, 10));
        cleanupEvents.push('gateway-settled');
      },
    };
    (controller as unknown as { toolRegistry: typeof failingRegistry }).toolRegistry =
      failingRegistry;
    (controller as unknown as { mcpGatewayService: typeof delayedGateway }).mcpGatewayService =
      delayedGateway;

    try {
      await expect(controller.cleanupRun({ runId: 'run-cleanup-failure' })).rejects.toBe(
        registryError,
      );
      expect(cleanupEvents).toEqual(['registry-failed', 'gateway-started', 'gateway-settled']);
    } finally {
      (controller as unknown as { toolRegistry: ToolRegistryService }).toolRegistry =
        toolRegistryService;
      (
        controller as unknown as {
          mcpGatewayService: { cleanupRun: (runId: string) => Promise<void> };
        }
      ).mcpGatewayService = {
        cleanupRun: async (runId: string) => {
          cleanedGatewayRuns.push(runId);
        },
      };
    }
  });

  it('rejects identity-less internal requests', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/mcp/register-component')
      .send({});

    // Should be caught by global AuthGuard
    expect(response.status).toBe(403);
  });
});
