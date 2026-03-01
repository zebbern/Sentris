import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
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
    return this.kv.delete(key) ? 1 : 0;
  }
  async quit() {}
}

describe('MCP Internal API (Integration)', () => {
  let app: INestApplication;
  let redis: MockRedis;
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
    const toolRegistryService = new ToolRegistryService(mockRedis as unknown as any, encryption);
    const mockGatewayService = {
      refreshServersForRun: async () => {},
    };

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
        { provide: McpGatewayService, useValue: mockGatewayService },
        { provide: McpAuthService, useValue: { generateSessionToken: async () => 'mock-token' } },
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
    const controller = moduleFixture.get(InternalMcpController);
    (controller as unknown as { toolRegistry: ToolRegistryService }).toolRegistry =
      toolRegistryService;
    (controller as unknown as { mcpGatewayService: typeof mockGatewayService }).mcpGatewayService =
      mockGatewayService;

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
          description: 'Search documents',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
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
    expect(tools[0].name).toBe('search');
    expect(tools[0].inputSchema).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
    });
  });

  it('rejects identity-less internal requests', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/mcp/register-component')
      .send({});

    // Should be caught by global AuthGuard
    expect(response.status).toBe(403);
  });
});
