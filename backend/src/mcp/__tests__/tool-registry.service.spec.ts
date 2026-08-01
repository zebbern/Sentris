import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { z } from 'zod';
import {
  componentRegistry,
  inputs,
  outputs,
  parameters,
  param,
  port,
  type ComponentDefinition,
} from '@sentris/component-sdk';
import { ToolRegistryService } from '../tool-registry.service';
import type { SecretsEncryptionService } from '../../secrets/secrets.encryption';
import { computeMcpBindingFingerprint } from '../../mcp-runtime/mcp-binding-fingerprint';

function dispatchComponent(profileExposed: boolean): ComponentDefinition {
  return {
    id: 'test.registry-dispatch-component',
    label: 'Registry dispatch component',
    category: 'security',
    runner: { kind: 'inline' },
    inputs: inputs({
      target: port(z.string(), { label: 'Target' }),
    }),
    outputs: outputs({}),
    parameters: parameters({
      profile: param(z.string().default('default'), {
        label: 'Profile',
        editor: 'text',
        exposeToTool: profileExposed,
      }),
    }),
    toolProvider: {
      kind: 'component',
      name: 'scan_target',
      description: 'Scan target',
    },
    execute: async () => ({}),
  };
}

const SNAPSHOT_COMPONENT = dispatchComponent(true);

// Mock Redis
class MockRedis {
  private data = new Map<string, Map<string, string>>();
  private kv = new Map<string, string>();
  readonly expirations: { key: string; seconds: number }[] = [];
  readonly hgetCalls: { key: string; field: string }[] = [];

  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.data.has(key)) {
      this.data.set(key, new Map());
    }
    this.data.get(key)!.set(field, value);
    return 1;
  }

  async hget(key: string, field: string): Promise<string | null> {
    this.hgetCalls.push({ key, field });
    return this.data.get(key)?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.data.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash.entries());
  }

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<string> {
    this.kv.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    this.data.delete(key);
    this.kv.delete(key);
    return 1;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.expirations.push({ key, seconds });
    return 1;
  }

  async quit(): Promise<void> {}
}

// Mock encryption service
class MockEncryptionService {
  decryptCalls = 0;
  failDecrypt = false;
  async encrypt(value: string): Promise<{ ciphertext: string; keyId: string }> {
    return {
      ciphertext: Buffer.from(value).toString('base64'),
      keyId: 'test-key',
    };
  }

  async decrypt(material: { ciphertext: string }): Promise<string> {
    this.decryptCalls += 1;
    if (this.failDecrypt) throw new Error('sensitive decrypt failure');
    return Buffer.from(material.ciphertext, 'base64').toString('utf-8');
  }
}

describe('ToolRegistryService', () => {
  let service: ToolRegistryService;
  let redis: MockRedis;
  let encryption: MockEncryptionService;
  let componentGetSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    redis = new MockRedis();
    encryption = new MockEncryptionService();
    service = new ToolRegistryService(redis as any, encryption as any as SecretsEncryptionService);
    componentGetSpy = vi.spyOn(componentRegistry, 'get') as unknown as ReturnType<typeof vi.fn>;
    componentGetSpy.mockReturnValue(SNAPSHOT_COMPONENT);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('registerComponentTool', () => {
    it('registers a component tool with encrypted credentials', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'check_ip_reputation',
        componentId: 'security.abuseipdb',
        description: 'Check IP reputation',
        inputSchema: {
          type: 'object',
          properties: { ipAddress: { type: 'string' } },
          required: ['ipAddress'],
        },
        credentials: { apiKey: 'secret-123' },
      });

      const tool = await service.getTool('run-1', 'node-a');
      expect(tool).not.toBeNull();
      expect(tool?.toolName).toBe('check_ip_reputation');
      expect(tool?.status).toBe('ready');
      expect(tool?.type).toBe('component');
      expect(tool?.encryptedCredentials).toBeDefined();
    });

    it('keeps run tool records available for the maximum agent session lifetime', async () => {
      await service.registerComponentTool({
        runId: 'run-registry-ttl',
        nodeId: 'node-a',
        toolName: 'check_ip_reputation',
        componentId: 'security.abuseipdb',
        description: 'Check IP reputation',
        inputSchema: { type: 'object', properties: {} },
        credentials: {},
      });

      expect(redis.expirations).toContainEqual({
        key: 'mcp:run:run-registry-ttl:tools',
        seconds: 10800,
      });
    });
  });

  describe('resolveComponentForDispatch', () => {
    const registration = {
      runId: 'run-dispatch',
      nodeId: 'node-dispatch',
      toolName: 'scan_target',
      componentId: SNAPSHOT_COMPONENT.id,
      description: 'Scan target',
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
        additionalProperties: false,
      },
      credentials: { apiKey: 'secret-123' },
      parameters: { timeout: 1000 },
    };

    it('loads once by run and immutable node, validates the binding, then decrypts', async () => {
      await service.registerComponentTool(registration);
      const stored = await service.getTool(registration.runId, registration.nodeId);
      if (!stored) throw new Error('fixture registration failed');
      redis.hgetCalls.length = 0;
      const descriptor = {
        name: registration.toolName,
        description: registration.description,
        inputSchema: registration.inputSchema,
      };

      await expect(
        service.resolveComponentForDispatch({
          runId: registration.runId,
          nodeId: registration.nodeId,
          componentId: registration.componentId,
          toolName: registration.toolName,
          bindingFingerprint: computeMcpBindingFingerprint(
            stored,
            [descriptor],
            SNAPSHOT_COMPONENT,
          ),
          descriptor,
        }),
      ).resolves.toEqual({ tool: stored, credentials: registration.credentials });
      expect(redis.hgetCalls).toEqual([
        {
          key: 'mcp:run:run-dispatch:tools',
          field: 'node-dispatch',
        },
      ]);
      expect(encryption.decryptCalls).toBe(1);
    });

    it('rejects a non-ready component before decrypting', async () => {
      await service.registerComponentTool(registration);
      const stored = await service.getTool(registration.runId, registration.nodeId);
      if (!stored) throw new Error('fixture registration failed');
      stored.status = 'pending';
      await redis.hset('mcp:run:run-dispatch:tools', registration.nodeId, JSON.stringify(stored));
      encryption.decryptCalls = 0;
      const descriptor = {
        name: registration.toolName,
        description: registration.description,
        inputSchema: registration.inputSchema,
      };

      await expect(
        service.resolveComponentForDispatch({
          runId: registration.runId,
          nodeId: registration.nodeId,
          componentId: registration.componentId,
          toolName: registration.toolName,
          bindingFingerprint: computeMcpBindingFingerprint(
            stored,
            [descriptor],
            SNAPSHOT_COMPONENT,
          ),
          descriptor,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(encryption.decryptCalls).toBe(0);
    });

    it('rejects an explicitly unexposed component before decrypting', async () => {
      await service.registerComponentTool(registration);
      const stored = await service.getTool(registration.runId, registration.nodeId);
      if (!stored) throw new Error('fixture registration failed');
      stored.exposedToAgent = false;
      await redis.hset('mcp:run:run-dispatch:tools', registration.nodeId, JSON.stringify(stored));
      encryption.decryptCalls = 0;
      const descriptor = {
        name: registration.toolName,
        description: registration.description,
        inputSchema: registration.inputSchema,
      };

      await expect(
        service.resolveComponentForDispatch({
          runId: registration.runId,
          nodeId: registration.nodeId,
          componentId: registration.componentId,
          toolName: registration.toolName,
          bindingFingerprint: computeMcpBindingFingerprint(
            stored,
            [descriptor],
            SNAPSHOT_COMPONENT,
          ),
          descriptor,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(encryption.decryptCalls).toBe(0);
    });

    it.each([
      ['missing', undefined],
      ['malformed', 'yes'],
    ])(
      'rejects %s exposure state before fingerprinting or decrypting',
      async (_label, exposure) => {
        await service.registerComponentTool(registration);
        const stored = await service.getTool(registration.runId, registration.nodeId);
        if (!stored) throw new Error('fixture registration failed');
        if (exposure === undefined) {
          delete stored.exposedToAgent;
        } else {
          stored.exposedToAgent = exposure as never;
        }
        await redis.hset('mcp:run:run-dispatch:tools', registration.nodeId, JSON.stringify(stored));
        encryption.decryptCalls = 0;
        const descriptor = {
          name: registration.toolName,
          description: registration.description,
          inputSchema: registration.inputSchema,
        };

        await expect(
          service.resolveComponentForDispatch({
            runId: registration.runId,
            nodeId: registration.nodeId,
            componentId: registration.componentId,
            toolName: registration.toolName,
            bindingFingerprint: computeMcpBindingFingerprint(
              stored,
              [descriptor],
              SNAPSHOT_COMPONENT,
            ),
            descriptor,
          }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(componentGetSpy).not.toHaveBeenCalled();
        expect(encryption.decryptCalls).toBe(0);
      },
    );

    it('rejects a fingerprint mismatch before decrypting', async () => {
      await service.registerComponentTool(registration);
      encryption.decryptCalls = 0;

      await expect(
        service.resolveComponentForDispatch({
          runId: registration.runId,
          nodeId: registration.nodeId,
          componentId: registration.componentId,
          toolName: registration.toolName,
          bindingFingerprint: 'f'.repeat(64),
          descriptor: {
            name: registration.toolName,
            description: registration.description,
            inputSchema: registration.inputSchema,
          },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(encryption.decryptCalls).toBe(0);
    });

    it('rejects current component definition drift before decrypting', async () => {
      await service.registerComponentTool(registration);
      const stored = await service.getTool(registration.runId, registration.nodeId);
      if (!stored) throw new Error('fixture registration failed');
      encryption.decryptCalls = 0;
      const descriptor = {
        name: registration.toolName,
        description: registration.description,
        inputSchema: registration.inputSchema,
      };
      const snapshotFingerprint = computeMcpBindingFingerprint(
        stored,
        [descriptor],
        SNAPSHOT_COMPONENT,
      );
      componentGetSpy.mockReturnValue(dispatchComponent(false));

      await expect(
        service.resolveComponentForDispatch({
          runId: registration.runId,
          nodeId: registration.nodeId,
          componentId: registration.componentId,
          toolName: registration.toolName,
          bindingFingerprint: snapshotFingerprint,
          descriptor,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(encryption.decryptCalls).toBe(0);
    });

    it('distinguishes absent credentials from sanitized decryption failure', async () => {
      await service.registerComponentTool({ ...registration, credentials: {} });
      const stored = await service.getTool(registration.runId, registration.nodeId);
      if (!stored) throw new Error('fixture registration failed');
      delete stored.encryptedCredentials;
      await redis.hset('mcp:run:run-dispatch:tools', registration.nodeId, JSON.stringify(stored));
      const descriptor = {
        name: registration.toolName,
        description: registration.description,
        inputSchema: registration.inputSchema,
      };
      const fingerprint = computeMcpBindingFingerprint(stored, [descriptor], SNAPSHOT_COMPONENT);

      await expect(
        service.resolveComponentForDispatch({
          runId: registration.runId,
          nodeId: registration.nodeId,
          componentId: registration.componentId,
          toolName: registration.toolName,
          bindingFingerprint: fingerprint,
          descriptor,
        }),
      ).resolves.toEqual({ tool: stored, credentials: null });

      stored.encryptedCredentials = JSON.stringify({ ciphertext: 'invalid', keyId: 'test-key' });
      await redis.hset('mcp:run:run-dispatch:tools', registration.nodeId, JSON.stringify(stored));
      encryption.failDecrypt = true;
      await expect(
        service.resolveComponentForDispatch({
          runId: registration.runId,
          nodeId: registration.nodeId,
          componentId: registration.componentId,
          toolName: registration.toolName,
          bindingFingerprint: computeMcpBindingFingerprint(
            stored,
            [descriptor],
            SNAPSHOT_COMPONENT,
          ),
          descriptor,
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('registerMcpServer', () => {
    it('registers an MCP server with pre-discovered tools', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'mcp-library',
        serverName: 'Test Server',
        transport: 'http',
        endpoint: 'http://localhost:8080/mcp',
        tools: [
          {
            name: 'search',
            description: 'Search documents',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          },
          { name: 'analyze', description: 'Analyze data' },
        ],
      });

      // Verify server entry is stored
      const tool = await service.getTool('run-1', 'mcp-library');
      expect(tool).not.toBeNull();
      expect(tool?.toolName).toBe('Test Server');
      expect(tool?.type).toBe('remote-mcp');
      expect(tool?.status).toBe('ready');
      expect(tool?.endpoint).toBe('http://localhost:8080/mcp');
    });

    it('stores pre-discovered tools in separate Redis key', async () => {
      const discoveredTools = [
        {
          name: 'fetch',
          title: 'Fetch URL',
          description: 'Fetch data',
          inputSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { url: { type: 'string', format: 'uri' } },
            unevaluatedProperties: false,
          },
          outputSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { status: { type: 'integer' } },
          },
          icons: [{ src: 'https://example.test/fetch.svg', theme: 'dark' as const }],
          annotations: { readOnlyHint: true },
          _meta: { 'com.example/source': 'registry-test' },
        },
        {
          name: 'store',
          description: 'Store data',
          inputSchema: {
            type: 'object',
            properties: { key: { type: 'string' }, value: { type: 'string' } },
          },
        },
      ];

      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'my-mcp-server',
        serverName: 'My MCP Server',
        transport: 'stdio',
        endpoint: 'http://localhost:9999',
        containerId: 'container-abc',
        tools: discoveredTools,
      });

      // Verify tools are retrievable via getServerTools
      const tools = await service.getServerTools('run-1', 'my-mcp-server');
      expect(tools).not.toBeNull();
      expect(tools?.length).toBe(2);
      expect(tools?.[0]).toEqual({
        name: 'fetch',
        title: 'Fetch URL',
        description: 'Fetch data',
        inputSchema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { url: { type: 'string', format: 'uri' } },
          unevaluatedProperties: false,
        },
        outputSchema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { status: { type: 'integer' } },
        },
        icons: [{ src: 'https://example.test/fetch.svg', theme: 'dark' }],
        annotations: { readOnlyHint: true },
        _meta: { 'com.example/source': 'registry-test' },
      });
      expect(tools?.[1].name).toBe('store');
    });

    it('registers stdio server with containerId', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'stdio-mcp',
        serverName: 'Steampipe',
        transport: 'stdio',
        endpoint: 'http://localhost:8080',
        containerId: 'container-123',
        tools: [{ name: 'query', description: 'Run SQL query' }],
      });

      const tool = await service.getTool('run-1', 'stdio-mcp');
      expect(tool?.type).toBe('mcp-server'); // stdio uses 'mcp-server' type
      expect(tool?.containerId).toBe('container-123');
    });

    it('encrypts headers when provided', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'auth-mcp',
        serverName: 'Auth MCP',
        transport: 'http',
        endpoint: 'http://localhost:8080',
        headers: { Authorization: 'Bearer secret-token' },
        tools: [],
      });

      const tool = await service.getTool('run-1', 'auth-mcp');
      expect(tool?.encryptedCredentials).toBeDefined();
    });
  });

  describe('getServerTools', () => {
    it('returns pre-discovered tools for a registered server', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'test-server',
        serverName: 'Test',
        transport: 'http',
        endpoint: 'http://localhost:8080',
        tools: [
          { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' } },
          { name: 'tool_b', description: 'Tool B' },
        ],
      });

      const tools = await service.getServerTools('run-1', 'test-server');
      expect(tools).toEqual([
        { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' } },
        { name: 'tool_b', description: 'Tool B' },
      ]);
    });

    it('returns null for unknown server', async () => {
      const tools = await service.getServerTools('run-1', 'unknown-server');
      expect(tools).toBeNull();
    });

    it('returns null for server without pre-discovered tools', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'empty-server',
        serverName: 'Empty',
        transport: 'http',
        endpoint: 'http://localhost:8080',
        // No tools provided
      });

      const tools = await service.getServerTools('run-1', 'empty-server');
      expect(tools).toBeNull();
    });
  });

  describe('getToolsForRun', () => {
    it('returns all tools for a run', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool_a',
        componentId: 'comp.a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-b',
        toolName: 'tool_b',
        componentId: 'comp.b',
        description: 'Tool B',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      const tools = await service.getToolsForRun('run-1');
      expect(tools.length).toBe(2);
      expect(tools.map((t) => t.toolName).sort()).toEqual(['tool_a', 'tool_b']);
    });

    it('filters by exact nodeIds', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool_a',
        componentId: 'comp.a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-b',
        toolName: 'tool_b',
        componentId: 'comp.b',
        description: 'Tool B',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      const tools = await service.getToolsForRun('run-1', ['node-a']);
      expect(tools.length).toBe(1);
      expect(tools[0].toolName).toBe('tool_a');
    });

    it('includes child MCP servers via hierarchical nodeId matching', async () => {
      // Parent group component
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'aws-mcp-group',
        toolName: 'aws-mcp-group',
        componentId: 'mcp.group.aws',
        description: 'AWS MCP Group',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
        exposedToAgent: false,
      });

      // Child MCP servers registered with hierarchical nodeIds
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'aws-mcp-group/aws-cloudtrail',
        serverName: 'aws-cloudtrail',
        transport: 'stdio',
        endpoint: 'http://localhost:8081',
        containerId: 'ct-container',
        tools: [{ name: 'lookup_events', description: 'Lookup CloudTrail events' }],
      });

      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'aws-mcp-group/aws-cloudwatch',
        serverName: 'aws-cloudwatch',
        transport: 'stdio',
        endpoint: 'http://localhost:8082',
        containerId: 'cw-container',
        tools: [{ name: 'get_metrics', description: 'Get CloudWatch metrics' }],
      });

      // Unrelated node that should NOT be included
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'other-mcp-server',
        serverName: 'other',
        transport: 'stdio',
        endpoint: 'http://localhost:9090',
        tools: [{ name: 'other_tool' }],
      });

      // Filter by parent nodeId should include parent + children
      const tools = await service.getToolsForRun('run-1', ['aws-mcp-group']);
      expect(tools.length).toBe(3);
      expect(tools.map((t) => t.nodeId).sort()).toEqual([
        'aws-mcp-group',
        'aws-mcp-group/aws-cloudtrail',
        'aws-mcp-group/aws-cloudwatch',
      ]);
    });

    it('does not match partial nodeId prefixes without separator', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'aws-mcp-group-extra',
        serverName: 'extra',
        transport: 'stdio',
        endpoint: 'http://localhost:8083',
        tools: [{ name: 'extra_tool' }],
      });

      const tools = await service.getToolsForRun('run-1', ['aws-mcp-group']);
      expect(tools.length).toBe(0);
    });
  });

  describe('getToolByName', () => {
    it('finds a tool by name', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'my_tool',
        componentId: 'comp.a',
        description: 'My Tool',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      const tool = await service.getToolByName('run-1', 'my_tool');
      expect(tool).not.toBeNull();
      expect(tool?.nodeId).toBe('node-a');
    });

    it('returns null for unknown tool name', async () => {
      const tool = await service.getToolByName('run-1', 'unknown');
      expect(tool).toBeNull();
    });
  });

  describe('getToolCredentials', () => {
    it('decrypts and returns credentials', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool',
        componentId: 'comp',
        description: 'Tool',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: { apiKey: 'secret-value', token: 'another-secret' },
      });

      const creds = await service.getToolCredentials('run-1', 'node-a');
      expect(creds).toEqual({ apiKey: 'secret-value', token: 'another-secret' });
    });

    it('decrypts MCP server headers as credentials', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'mcp-with-auth',
        serverName: 'Auth Server',
        transport: 'http',
        endpoint: 'http://localhost:8080',
        headers: { Authorization: 'Bearer my-token' },
        tools: [],
      });

      const creds = await service.getToolCredentials('run-1', 'mcp-with-auth');
      expect(creds).toEqual({ Authorization: 'Bearer my-token' });
    });

    it('decrypts the supplied captured record without reading a replacement registration', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'mcp-with-auth',
        serverName: 'Auth Server',
        transport: 'http',
        endpoint: 'http://localhost:8080',
        headers: { Authorization: 'Bearer captured-token' },
        tools: [],
      });
      const captured = await service.getTool('run-1', 'mcp-with-auth');
      if (!captured) throw new Error('fixture registration failed');

      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'mcp-with-auth',
        serverName: 'Auth Server',
        transport: 'http',
        endpoint: 'http://localhost:8080',
        headers: { Authorization: 'Bearer replacement-token' },
        tools: [],
      });
      redis.hgetCalls.length = 0;

      await expect(service.decryptToolCredentials(captured)).resolves.toEqual({
        Authorization: 'Bearer captured-token',
      });
      expect(redis.hgetCalls).toEqual([]);
    });
  });

  describe('areAllToolsReady', () => {
    it('returns true when all required tools are ready', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool_a',
        componentId: 'comp.a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-b',
        toolName: 'tool_b',
        componentId: 'comp.b',
        description: 'Tool B',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      const ready = await service.areAllToolsReady('run-1', ['node-a', 'node-b']);
      expect(ready).toBe(true);
    });

    it('returns false when a required tool is missing', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool_a',
        componentId: 'comp.a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      const ready = await service.areAllToolsReady('run-1', ['node-a', 'node-b']);
      expect(ready).toBe(false);
    });
  });

  describe('cleanupRun', () => {
    it('removes all tools and returns container IDs', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool_a',
        componentId: 'comp.a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'mcp-server',
        serverName: 'Steampipe',
        transport: 'stdio',
        endpoint: 'http://localhost:8080',
        containerId: 'container-123',
        tools: [{ name: 'query' }],
      });

      const containerIds = await service.cleanupRun('run-1');
      expect(containerIds).toEqual(['container-123']);

      const tools = await service.getToolsForRun('run-1');
      expect(tools.length).toBe(0);
    });
  });
});
