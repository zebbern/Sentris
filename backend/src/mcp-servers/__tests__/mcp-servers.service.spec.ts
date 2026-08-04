import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { McpCatalog, McpRuntimeKey } from '@sentris/shared';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import type { AuditLogService } from '../../audit/audit-log.service';
import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';
import type { AuthContext } from '../../auth/types';
import type { McpServerRecord, McpServerToolRecord } from '../../database/schema';
import type { SecretResolver } from '../../secrets/secret-resolver';
import type { McpServerRuntimeConfigService } from '../mcp-server-runtime-config.service';
import type { McpSavedServerRuntimeService } from '../mcp-saved-server-runtime.service';
import type { McpServersEncryptionService } from '../mcp-servers.encryption';
import type { McpServersRepository } from '../mcp-servers.repository';
import { McpServersService } from '../mcp-servers.service';

const now = new Date('2024-06-01T00:00:00.000Z');
const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const CONFIG_FINGERPRINT = 'a'.repeat(64);
const PRINCIPAL_PARTITION_HASH = 'b'.repeat(64);
const CAPABILITY_FINGERPRINT = 'c'.repeat(64);

function makeRuntimeKey(transport: 'http' | 'stdio'): McpRuntimeKey {
  return {
    sourceId: 'server-1',
    transport,
    configFingerprint: CONFIG_FINGERPRINT,
    organizationId: DEFAULT_ORGANIZATION_ID,
    principalPartitionHash: PRINCIPAL_PARTITION_HASH,
    credentialReference: 'mcp-server:server-1',
    credentialGeneration: now.getTime(),
  };
}

function makeCatalog(): McpCatalog {
  return {
    protocolEra: 'modern',
    protocolVersion: '2026-07-28',
    capabilityFingerprint: CAPABILITY_FINGERPRINT,
    tools: [
      {
        canonicalName: 'server-1__fetch_url',
        displayName: 'Fetch URL',
        description: 'Fetches a URL',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
        source: {
          kind: 'mcp',
          sourceId: 'server-1',
          serverId: 'server-1',
          upstreamName: 'fetch_url',
          bindingFingerprint: CONFIG_FINGERPRINT,
        },
        effects: 'unknown',
        effectsSource: 'unknown',
        retryPolicy: 'pre-dispatch-only',
      },
    ],
    resources: [],
    resourceTemplates: [],
    prompts: [],
  };
}

function makeServerRecord(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'server-1',
    name: 'test-mcp-server',
    description: 'A test MCP server',
    transportType: 'http',
    endpoint: 'http://localhost:3100/mcp',
    command: null,
    args: null,
    headers: null,
    headerSecretReferences: [],
    argSecretReferences: [],
    enabled: true,
    healthCheckUrl: null,
    lastHealthCheck: null,
    lastHealthStatus: null,
    capabilityCatalog: null,
    capabilityCatalogDiscoveredAt: null,
    groupId: null,
    registrySourceName: null,
    organizationId: DEFAULT_ORGANIZATION_ID,
    createdBy: 'tester',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeToolRecord(overrides: Partial<McpServerToolRecord> = {}): McpServerToolRecord {
  return {
    id: 'tool-1',
    serverId: 'server-1',
    toolName: 'readFile',
    description: 'Reads a file',
    inputSchema: { type: 'object' },
    enabled: true,
    discoveredAt: now,
    ...overrides,
  };
}

describe('McpServersService', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let encryption: Record<string, ReturnType<typeof vi.fn>>;
  let secretResolver: Record<string, ReturnType<typeof vi.fn>>;
  let auditLog: Record<string, ReturnType<typeof vi.fn>>;
  let redis: Record<string, ReturnType<typeof vi.fn>>;
  let runtimeConfigService: Record<string, ReturnType<typeof vi.fn>>;
  let savedServerDiscovery: Record<string, ReturnType<typeof vi.fn>>;
  let mutationExecutor: { insert: ReturnType<typeof vi.fn> };
  let service: McpServersService;

  function mockMutationResult(
    operation: ReturnType<typeof vi.fn>,
    result: unknown,
    hookIndex: number,
  ): void {
    operation.mockImplementation(async (...args: unknown[]) => {
      const hook = args[hookIndex] as
        | ((executor: unknown, record?: unknown) => Promise<void>)
        | undefined;
      await hook?.(mutationExecutor, result);
      return result;
    });
  }

  beforeEach(() => {
    mutationExecutor = { insert: vi.fn() };
    repo = {
      list: vi.fn(),
      listEnabled: vi.fn(),
      findById: vi.fn(),
      findByName: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateHealthStatus: vi.fn(),
      delete: vi.fn(),
      listTools: vi.fn(),
      listAllToolsForOrganization: vi.fn(),
      upsertTools: vi.fn(),
      persistDiscovery: vi.fn(),
      toggleToolEnabled: vi.fn(),
      clearTools: vi.fn(),
    };
    encryption = { encryptHeaders: vi.fn(), decryptHeaders: vi.fn() };
    secretResolver = { resolveMcpConfig: vi.fn() };
    auditLog = {
      record: vi.fn(),
      recordDurableWithExecutor: vi.fn(async () => undefined),
    };
    redis = { get: vi.fn(), del: vi.fn() };
    runtimeConfigService = {
      buildRuntimeKey: vi.fn(async () => makeRuntimeKey('http')),
    };
    savedServerDiscovery = {
      discover: vi.fn(async () => makeCatalog()),
      preview: vi.fn(async () => ({
        kind: 'resource',
        target: 'sentris://packages/react',
        output: { contents: [{ uri: 'sentris://packages/react', text: 'React' }] },
      })),
    };

    service = new McpServersService(
      repo as unknown as McpServersRepository,
      encryption as unknown as McpServersEncryptionService,
      secretResolver as unknown as SecretResolver,
      redis as any,
      auditLog as unknown as AuditLogService,
      runtimeConfigService as unknown as McpServerRuntimeConfigService,
      savedServerDiscovery as unknown as McpSavedServerRuntimeService,
    );
  });

  // ── List ──────────────────────────────────────────────────────────
  it('lists all servers for the organization', async () => {
    repo.list.mockResolvedValue([makeServerRecord()]);
    const result = await service.listServers(authContext);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('server-1');
    expect(repo.list).toHaveBeenCalledWith({
      organizationId: DEFAULT_ORGANIZATION_ID,
      groupId: undefined,
    });
  });

  it('lists enabled servers only', async () => {
    repo.listEnabled.mockResolvedValue([makeServerRecord()]);
    const result = await service.listEnabledServers(authContext);
    expect(result).toHaveLength(1);
    expect(repo.listEnabled).toHaveBeenCalledWith({
      organizationId: DEFAULT_ORGANIZATION_ID,
      groupId: undefined,
    });
  });

  it('passes groupId filter when listing servers', async () => {
    repo.list.mockResolvedValue([]);
    await service.listServers(authContext, { groupId: 'group-x' });
    expect(repo.list).toHaveBeenCalledWith({
      organizationId: DEFAULT_ORGANIZATION_ID,
      groupId: 'group-x',
    });
  });

  // ── Get ───────────────────────────────────────────────────────────
  it('returns a server with header keys extracted', async () => {
    const record = makeServerRecord({
      headers: { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyId: 'k1' },
    });
    repo.findById.mockResolvedValue(record);
    encryption.decryptHeaders.mockResolvedValue({ Authorization: 'Bearer tok' });
    const result = await service.getServer(authContext, 'server-1');
    expect(result.hasHeaders).toBe(true);
    expect(result.headerKeys).toEqual(['Authorization']);
  });

  it('returns null headerKeys when server has no headers', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    const result = await service.getServer(authContext, 'server-1');
    expect(result.headerKeys).toBeNull();
  });

  // ── Create ────────────────────────────────────────────────────────
  it('creates a server with http transport', async () => {
    repo.list.mockResolvedValue([]);
    mockMutationResult(repo.create, makeServerRecord(), 1);
    const result = await service.createServer(authContext, {
      name: 'test-mcp-server',
      transportType: 'http',
      endpoint: 'http://localhost:3100/mcp',
    });
    expect(result.id).toBe('server-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test-mcp-server', transportType: 'http' }),
      expect.any(Function),
    );
    expect(auditLog.recordDurableWithExecutor).toHaveBeenCalledWith(
      mutationExecutor,
      authContext,
      expect.objectContaining({ action: 'mcp_server.create' }),
    );
  });

  it('rejects server creation when durable audit scheduling fails', async () => {
    repo.list.mockResolvedValue([]);
    mockMutationResult(repo.create, makeServerRecord(), 1);
    auditLog.recordDurableWithExecutor.mockRejectedValueOnce(new Error('audit outbox unavailable'));

    await expect(
      service.createServer(authContext, {
        name: 'test-mcp-server',
        transportType: 'http',
        endpoint: 'https://mcp.example.test',
      }),
    ).rejects.toThrow('audit outbox unavailable');
  });

  it('encrypts headers when creating a server', async () => {
    repo.list.mockResolvedValue([]);
    mockMutationResult(
      repo.create,
      makeServerRecord({ headers: { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyId: 'k1' } }),
      1,
    );
    encryption.encryptHeaders.mockResolvedValue({
      ciphertext: 'ct',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'k1',
    });
    await service.createServer(authContext, {
      name: 'test',
      transportType: 'http',
      endpoint: 'http://x',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(encryption.encryptHeaders).toHaveBeenCalledWith({ Authorization: 'Bearer tok' });
  });

  it('encrypts and indexes stdio environment credentials when creating a server', async () => {
    const secretId = '00000000-0000-4000-8000-000000000001';
    const encryptedHeaders = { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyId: 'k1' };
    repo.list.mockResolvedValue([]);
    mockMutationResult(
      repo.create,
      makeServerRecord({
        transportType: 'stdio',
        endpoint: null,
        command: 'docker',
        args: ['run', '-i', '--rm', 'mcp/example'],
        headers: encryptedHeaders,
        headerSecretReferences: [secretId],
      }),
      1,
    );
    encryption.encryptHeaders.mockResolvedValue(encryptedHeaders);

    const result = await service.createServer(authContext, {
      name: 'authenticated-stdio',
      transportType: 'stdio',
      command: 'docker',
      args: ['run', '-i', '--rm', 'mcp/example'],
      headers: { 'env:API_TOKEN': `{{secret:${secretId}}}` },
    });

    expect(encryption.encryptHeaders).toHaveBeenCalledWith({
      'env:API_TOKEN': `{{secret:${secretId}}}`,
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: encryptedHeaders,
        headerSecretReferences: [secretId],
        argSecretReferences: [],
      }),
      expect.any(Function),
    );
    expect(result.hasHeaders).toBe(true);
    expect(result.headerKeys).toEqual(['env:API_TOKEN']);
  });

  it('indexes only HTTP header dependencies while creating an HTTP server', async () => {
    const secretId = '00000000-0000-4000-8000-000000000001';
    repo.list.mockResolvedValue([]);
    mockMutationResult(repo.create, makeServerRecord(), 1);
    encryption.encryptHeaders.mockResolvedValue({
      ciphertext: 'ct',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'k1',
    });

    await service.createServer(authContext, {
      name: 'test',
      transportType: 'http',
      endpoint: 'https://mcp.example.test/mcp',
      headers: { Authorization: `Bearer {{secret:${secretId}}}` },
      args: [`--token={{secret:${secretId}}}`],
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        command: null,
        args: null,
        headerSecretReferences: [secretId],
        argSecretReferences: [],
      }),
      expect.any(Function),
    );
  });

  it('rejects creation when a duplicate name exists', async () => {
    repo.list.mockResolvedValue([makeServerRecord()]);
    await expect(
      service.createServer(authContext, {
        name: 'test-mcp-server',
        transportType: 'http',
        endpoint: 'http://x',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when http transport is missing endpoint', async () => {
    await expect(
      service.createServer(authContext, { name: 'bad', transportType: 'http' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when stdio transport is missing command', async () => {
    await expect(
      service.createServer(authContext, { name: 'bad', transportType: 'stdio' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('uses cached discovery tools when cacheToken is provided', async () => {
    repo.list.mockResolvedValue([]);
    mockMutationResult(repo.create, makeServerRecord(), 1);
    repo.upsertTools.mockResolvedValue([]);
    repo.updateHealthStatus.mockResolvedValue(undefined);
    redis.get.mockResolvedValue(
      JSON.stringify({
        status: 'completed',
        organizationId: DEFAULT_ORGANIZATION_ID,
        tools: [{ name: 'readFile', description: 'Read' }],
        toolCount: 1,
      }),
    );
    redis.del.mockResolvedValue(1);
    await service.createServer(authContext, {
      name: 'test',
      transportType: 'http',
      endpoint: 'http://x',
      cacheToken: 'cache-123',
    });
    expect(redis.get).toHaveBeenCalledWith('mcp-discovery:cache-123');
    expect(repo.upsertTools).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('mcp-discovery:cache-123');
  });

  it('rejects a foreign-organization cache token before creating a server', async () => {
    repo.list.mockResolvedValue([]);
    mockMutationResult(repo.create, makeServerRecord(), 1);
    repo.upsertTools.mockResolvedValue([]);
    repo.updateHealthStatus.mockResolvedValue(undefined);
    redis.get.mockResolvedValue(
      JSON.stringify({
        status: 'completed',
        organizationId: 'foreign-organization',
        tools: [{ name: 'readFile', description: 'Read' }],
        toolCount: 1,
      }),
    );

    await expect(
      service.createServer(authContext, {
        name: 'test',
        transportType: 'http',
        endpoint: 'http://x',
        cacheToken: 'foreign-cache',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(repo.list).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.upsertTools).not.toHaveBeenCalled();
  });

  // ── Update ────────────────────────────────────────────────────────
  it('updates server name and description', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    mockMutationResult(repo.update, makeServerRecord({ name: 'renamed', description: 'new' }), 3);
    const result = await service.updateServer(authContext, 'server-1', {
      name: 'renamed',
      description: 'new',
    });
    expect(result.name).toBe('renamed');
    expect(auditLog.recordDurableWithExecutor).toHaveBeenCalledWith(
      mutationExecutor,
      authContext,
      expect.objectContaining({ action: 'mcp_server.update' }),
    );
  });

  it('returns current server when update has no changes', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    const result = await service.updateServer(authContext, 'server-1', {});
    expect(result.id).toBe('server-1');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('encrypts headers during update', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    mockMutationResult(repo.update, makeServerRecord(), 3);
    encryption.encryptHeaders.mockResolvedValue({
      ciphertext: 'ct2',
      iv: 'iv2',
      authTag: 'tag2',
      keyId: 'k2',
    });
    await service.updateServer(authContext, 'server-1', { headers: { 'X-Key': 'secret' } });
    expect(encryption.encryptHeaders).toHaveBeenCalledWith({ 'X-Key': 'secret' });
  });

  it('re-encrypts active stdio environment credentials during update', async () => {
    const secretId = '00000000-0000-4000-8000-000000000002';
    const encryptedHeaders = { ciphertext: 'ct2', iv: 'iv2', authTag: 'tag2', keyId: 'k2' };
    repo.findById.mockResolvedValue(
      makeServerRecord({
        transportType: 'stdio',
        endpoint: null,
        command: 'docker',
        args: ['run', '-i', '--rm', 'mcp/example'],
        headers: { ciphertext: 'old', iv: 'old-iv', authTag: 'old-tag', keyId: 'k1' },
      }),
    );
    mockMutationResult(
      repo.update,
      makeServerRecord({
        transportType: 'stdio',
        endpoint: null,
        command: 'docker',
        args: ['run', '-i', '--rm', 'mcp/example'],
        headers: encryptedHeaders,
        headerSecretReferences: [secretId],
      }),
      3,
    );
    encryption.encryptHeaders.mockResolvedValue(encryptedHeaders);

    await service.updateServer(authContext, 'server-1', {
      headers: { 'env:API_TOKEN': `{{secret:${secretId}}}` },
    });

    expect(repo.update).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        headers: encryptedHeaders,
        headerSecretReferences: [secretId],
      }),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('leaves stored stdio environment credentials intact on unrelated updates', async () => {
    repo.findById.mockResolvedValue(
      makeServerRecord({
        transportType: 'stdio',
        endpoint: null,
        command: 'mcp-server',
        args: [],
        headers: { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyId: 'k1' },
        headerSecretReferences: ['00000000-0000-4000-8000-000000000001'],
      }),
    );
    mockMutationResult(repo.update, makeServerRecord({ name: 'renamed' }), 3);

    await service.updateServer(authContext, 'server-1', { name: 'renamed' });

    expect(repo.update.mock.calls[0]?.[1]).not.toHaveProperty('headers');
    expect(repo.update.mock.calls[0]?.[1]).not.toHaveProperty('headerSecretReferences');
  });

  it('clears headers when null is provided', async () => {
    repo.findById.mockResolvedValue(
      makeServerRecord({ headers: { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyId: 'k1' } }),
    );
    mockMutationResult(repo.update, makeServerRecord(), 3);
    await service.updateServer(authContext, 'server-1', { headers: null });
    expect(repo.update).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({ headers: null }),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('updates argument dependencies without rewriting the header dependency column', async () => {
    const headerSecretId = '00000000-0000-4000-8000-000000000001';
    const argumentSecretId = '00000000-0000-4000-8000-000000000002';
    repo.findById.mockResolvedValue(
      makeServerRecord({
        transportType: 'stdio',
        endpoint: null,
        command: 'mcp-server',
        args: [`--token={{secret:${argumentSecretId}}}`],
        headerSecretReferences: [headerSecretId],
        argSecretReferences: [argumentSecretId],
      }),
    );
    mockMutationResult(repo.update, makeServerRecord(), 3);

    await service.updateServer(authContext, 'server-1', { args: [] });

    expect(repo.update).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        argSecretReferences: [],
      }),
      expect.any(Object),
      expect.any(Function),
    );
    expect(repo.update.mock.calls[0]?.[1]).not.toHaveProperty('headerSecretReferences');
    expect(encryption.decryptHeaders).not.toHaveBeenCalled();
  });

  it('canonicalizes inactive HTTP fields when switching to stdio', async () => {
    const argumentSecretId = '00000000-0000-4000-8000-000000000002';
    repo.findById.mockResolvedValue(makeServerRecord());
    mockMutationResult(
      repo.update,
      makeServerRecord({
        transportType: 'stdio',
        endpoint: null,
        command: 'mcp-server',
        args: [`--token={{secret:${argumentSecretId}}}`],
        headers: null,
      }),
      4,
    );

    await service.updateServer(authContext, 'server-1', {
      transportType: 'stdio',
      command: 'mcp-server',
      args: [`--token={{secret:${argumentSecretId}}}`],
    });

    expect(repo.update).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        endpoint: null,
        headers: null,
        headerSecretReferences: [],
        command: 'mcp-server',
        args: [`--token={{secret:${argumentSecretId}}}`],
        argSecretReferences: [argumentSecretId],
      }),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('rejects empty server name during update', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    await expect(service.updateServer(authContext, 'server-1', { name: '   ' })).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── Toggle & Delete ───────────────────────────────────────────────
  it('toggles server enabled state', async () => {
    repo.findById.mockResolvedValue(makeServerRecord({ enabled: true }));
    mockMutationResult(repo.update, makeServerRecord({ enabled: false }), 3);
    const result = await service.toggleServer(authContext, 'server-1');
    expect(result.enabled).toBe(false);
    expect(auditLog.recordDurableWithExecutor).toHaveBeenCalledWith(
      mutationExecutor,
      authContext,
      expect.objectContaining({ action: 'mcp_server.toggle' }),
    );
  });

  it('deletes a server and records audit log', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    mockMutationResult(repo.delete, undefined, 2);
    await service.deleteServer(authContext, 'server-1');
    expect(repo.delete).toHaveBeenCalledWith(
      'server-1',
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
      },
      expect.any(Function),
    );
    expect(auditLog.recordDurableWithExecutor).toHaveBeenCalledWith(
      mutationExecutor,
      authContext,
      expect.objectContaining({ action: 'mcp_server.delete' }),
    );
  });

  // ── Tools ─────────────────────────────────────────────────────────
  it('lists tools for a server', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    repo.listTools.mockResolvedValue([makeToolRecord()]);
    const result = await service.getServerTools(authContext, 'server-1');
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe('readFile');
    expect(result[0].serverName).toBe('test-mcp-server');
  });

  it('returns the latest complete saved-server capability catalog', async () => {
    const catalog = {
      ...makeCatalog(),
      resourceTemplates: [
        { sourceId: 'server-1', uriTemplate: 'sentris://packages/{name}', name: 'Package' },
      ],
    };
    repo.findById.mockResolvedValue(
      makeServerRecord({
        capabilityCatalog: catalog,
        capabilityCatalogDiscoveredAt: new Date('2026-08-04T12:34:56.000Z'),
      }),
    );

    await expect(service.getServerCapabilities(authContext, 'server-1')).resolves.toEqual({
      catalog,
      discoveredAt: '2026-08-04T12:34:56.000Z',
      resourceTemplateVariables: { 'sentris://packages/{name}': ['name'] },
    });
    expect(repo.findById).toHaveBeenCalledWith('server-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('expands a catalog-backed resource template before previewing the saved runtime', async () => {
    const runtimeKey = makeRuntimeKey('http');
    runtimeConfigService.buildRuntimeKey.mockResolvedValue(runtimeKey);
    repo.findById.mockResolvedValue(
      makeServerRecord({
        capabilityCatalog: {
          ...makeCatalog(),
          resourceTemplates: [
            { sourceId: 'server-1', uriTemplate: 'sentris://packages/{name}', name: 'Package' },
          ],
        },
      }),
    );

    await service.previewCapability(authContext, 'server-1', {
      kind: 'resource-template',
      uriTemplate: 'sentris://packages/{name}',
      arguments: { name: 'react' },
    });

    expect(savedServerDiscovery.preview).toHaveBeenCalledWith(runtimeKey, {
      kind: 'resource-read',
      uri: 'sentris://packages/react',
    });
  });

  it('rejects missing required prompt arguments before acquiring a runtime', async () => {
    repo.findById.mockResolvedValue(
      makeServerRecord({
        capabilityCatalog: {
          ...makeCatalog(),
          prompts: [
            {
              sourceId: 'server-1',
              name: 'investigate',
              arguments: [{ name: 'package', required: true }],
            },
          ],
        },
      }),
    );

    await expect(
      service.previewCapability(authContext, 'server-1', {
        kind: 'prompt',
        name: 'investigate',
        arguments: {},
      }),
    ).rejects.toThrow('Missing required prompt arguments: package');
    expect(runtimeConfigService.buildRuntimeKey).not.toHaveBeenCalled();
    expect(savedServerDiscovery.preview).not.toHaveBeenCalled();
  });

  it('tests HTTP MCP servers through the secret-free saved-server workflow input', async () => {
    const runtimeKey = makeRuntimeKey('http');
    runtimeConfigService.buildRuntimeKey.mockResolvedValue(runtimeKey);
    repo.findById.mockResolvedValue(
      makeServerRecord({
        headers: {
          ciphertext: 'encrypted-bearer-token',
          iv: 'iv',
          authTag: 'tag',
          keyId: 'key-1',
        },
      }),
    );
    repo.persistDiscovery.mockResolvedValue(undefined);
    repo.updateHealthStatus.mockResolvedValue(undefined);

    const result = await service.testServerConnection(authContext, 'server-1');

    expect(result).toEqual({
      success: true,
      message: 'Connection successful (1 tools, 0 resources, 0 templates, 0 prompts discovered)',
      toolCount: 1,
    });
    expect(runtimeConfigService.buildRuntimeKey).toHaveBeenCalledWith(authContext, 'server-1');
    expect(savedServerDiscovery.discover).toHaveBeenCalledWith(runtimeKey);
    const serializedWorkflowInput = JSON.stringify(savedServerDiscovery.discover.mock.calls[0]);
    expect(serializedWorkflowInput).not.toContain('encrypted-bearer-token');
    expect(serializedWorkflowInput).not.toContain('localhost:3100');
    expect(encryption.decryptHeaders).not.toHaveBeenCalled();
    expect(secretResolver.resolveMcpConfig).not.toHaveBeenCalled();
    expect(repo.persistDiscovery).toHaveBeenCalledWith('server-1', makeCatalog());
    expect(repo.updateHealthStatus).not.toHaveBeenCalled();
  });

  it('tests STDIO MCP servers through the same saved-server runtime workflow', async () => {
    const runtimeKey = makeRuntimeKey('stdio');
    runtimeConfigService.buildRuntimeKey.mockResolvedValue(runtimeKey);
    repo.findById.mockResolvedValue(
      makeServerRecord({
        transportType: 'stdio',
        endpoint: null,
        command: 'mcp-fetch',
        args: ['--stdio'],
      }),
    );
    repo.persistDiscovery.mockResolvedValue(undefined);
    repo.updateHealthStatus.mockResolvedValue(undefined);

    const result = await service.testServerConnection(authContext, 'server-1');

    expect(result).toEqual({
      success: true,
      message: 'Connection successful (1 tools, 0 resources, 0 templates, 0 prompts discovered)',
      toolCount: 1,
    });
    expect(savedServerDiscovery.discover).toHaveBeenCalledWith(runtimeKey);
    expect(repo.persistDiscovery).toHaveBeenCalledWith('server-1', makeCatalog());
    expect(repo.updateHealthStatus).not.toHaveBeenCalled();
  });

  it('marks STDIO MCP servers unhealthy when discovery workflow returns failed status', async () => {
    runtimeConfigService.buildRuntimeKey.mockResolvedValue(makeRuntimeKey('stdio'));
    savedServerDiscovery.discover.mockRejectedValue(
      new Error('MCP saved-server discovery failed: Failed to parse JSON'),
    );
    repo.findById.mockResolvedValue(
      makeServerRecord({
        transportType: 'stdio',
        endpoint: null,
        command: 'mcp-fetch',
      }),
    );
    repo.updateHealthStatus.mockResolvedValue(undefined);

    const result = await service.testServerConnection(authContext, 'server-1');

    expect(result).toEqual({
      success: false,
      message: 'MCP saved-server discovery failed: Failed to parse JSON',
    });
    expect(repo.persistDiscovery).not.toHaveBeenCalled();
    expect(repo.updateHealthStatus).toHaveBeenCalledWith('server-1', 'unhealthy', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('rejects a partial tool-only result from the saved-server workflow', async () => {
    savedServerDiscovery.discover.mockRejectedValue(new Error('Invalid MCP catalog'));
    repo.findById.mockResolvedValue(makeServerRecord());
    repo.updateHealthStatus.mockResolvedValue(undefined);

    const result = await service.testServerConnection(authContext, 'server-1');

    expect(result).toEqual({
      success: false,
      message: 'Invalid MCP catalog',
    });
    expect(repo.persistDiscovery).not.toHaveBeenCalled();
    expect(repo.updateHealthStatus).toHaveBeenCalledWith('server-1', 'unhealthy', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('lists all tools across enabled servers', async () => {
    repo.listAllToolsForOrganization.mockResolvedValue([
      { ...makeToolRecord(), serverName: 'srv' },
    ]);
    const result = await service.getAllTools(authContext);
    expect(result).toHaveLength(1);
  });

  it('toggles tool enabled state', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    const toggled = makeToolRecord({ enabled: false });
    mockMutationResult(repo.toggleToolEnabled, toggled, 2);

    const result = await service.toggleToolEnabled(authContext, 'server-1', 'tool-1');

    expect(result.enabled).toBe(false);
    expect(repo.toggleToolEnabled).toHaveBeenCalledWith('server-1', 'tool-1', expect.any(Function));
    expect(auditLog.recordDurableWithExecutor).toHaveBeenCalledWith(
      mutationExecutor,
      authContext,
      expect.objectContaining({
        action: 'mcp_server.tool_toggle',
        resourceId: 'server-1',
        metadata: expect.objectContaining({
          toolId: 'tool-1',
          toolName: 'readFile',
          enabled: false,
        }),
      }),
    );
  });

  it('rejects the tool toggle when durable audit scheduling fails', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    mockMutationResult(repo.toggleToolEnabled, makeToolRecord({ enabled: false }), 2);
    auditLog.recordDurableWithExecutor.mockRejectedValueOnce(new Error('audit outbox unavailable'));

    await expect(service.toggleToolEnabled(authContext, 'server-1', 'tool-1')).rejects.toThrow(
      'audit outbox unavailable',
    );
  });

  // ── Health ────────────────────────────────────────────────────────
  it('updates health status', async () => {
    repo.updateHealthStatus.mockResolvedValue(undefined);
    await service.updateHealthStatus(authContext, 'server-1', 'healthy');
    expect(repo.updateHealthStatus).toHaveBeenCalledWith('server-1', 'healthy', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
  });

  it('returns health statuses for enabled servers', async () => {
    repo.listEnabled.mockResolvedValue([
      makeServerRecord({ lastHealthStatus: 'healthy', lastHealthCheck: now }),
    ]);
    const result = await service.getHealthStatuses(authContext);
    expect(result).toEqual([
      { serverId: 'server-1', status: 'healthy', checkedAt: now.toISOString() },
    ]);
  });

  it('tests all enabled servers and returns per-server results', async () => {
    const enabledServers = [
      makeServerRecord({ id: 'server-1', name: 'fetch-reference' }),
      makeServerRecord({ id: 'server-2', name: 'semgrep-mcp' }),
    ];
    repo.listEnabled.mockResolvedValue(enabledServers);

    const testSpy = vi.spyOn(service, 'testServerConnection');
    testSpy.mockResolvedValueOnce({
      success: true,
      message: 'Connection successful (1 tools, 0 resources, 0 templates, 0 prompts discovered)',
      toolCount: 1,
    });
    testSpy.mockResolvedValueOnce({
      success: false,
      message: 'Connection failed: unauthorized',
    });

    const result = await service.testEnabledServers(authContext);

    expect(repo.listEnabled).toHaveBeenCalledWith({ organizationId: DEFAULT_ORGANIZATION_ID });
    expect(testSpy).toHaveBeenCalledWith(authContext, 'server-1');
    expect(testSpy).toHaveBeenCalledWith(authContext, 'server-2');
    expect(result).toEqual([
      {
        serverId: 'server-1',
        serverName: 'fetch-reference',
        success: true,
        message: 'Connection successful (1 tools, 0 resources, 0 templates, 0 prompts discovered)',
        toolCount: 1,
      },
      {
        serverId: 'server-2',
        serverName: 'semgrep-mcp',
        success: false,
        message: 'Connection failed: unauthorized',
      },
    ]);
  });

  it('keeps batch testing remaining servers when one test throws', async () => {
    repo.listEnabled.mockResolvedValue([
      makeServerRecord({ id: 'server-1', name: 'broken-fetch' }),
      makeServerRecord({ id: 'server-2', name: 'working-fetch' }),
    ]);

    const testSpy = vi.spyOn(service, 'testServerConnection');
    testSpy.mockRejectedValueOnce(new Error('container exited before MCP initialized'));
    testSpy.mockResolvedValueOnce({
      success: true,
      message: 'Connection successful (1 tools, 0 resources, 0 templates, 0 prompts discovered)',
      toolCount: 1,
    });

    const result = await service.testEnabledServers(authContext);

    expect(result).toEqual([
      {
        serverId: 'server-1',
        serverName: 'broken-fetch',
        success: false,
        message: 'container exited before MCP initialized',
      },
      {
        serverId: 'server-2',
        serverName: 'working-fetch',
        success: true,
        message: 'Connection successful (1 tools, 0 resources, 0 templates, 0 prompts discovered)',
        toolCount: 1,
      },
    ]);
  });

  // ── Decrypted headers & resolved config ───────────────────────────
  it('returns decrypted headers for a server', async () => {
    repo.findById.mockResolvedValue(
      makeServerRecord({ headers: { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyId: 'k1' } }),
    );
    encryption.decryptHeaders.mockResolvedValue({ Authorization: 'Bearer tok' });
    const result = await service.getServerWithDecryptedHeaders(authContext, 'server-1');
    expect(result.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('returns null headers when server has none', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    const result = await service.getServerWithDecryptedHeaders(authContext, 'server-1');
    expect(result.headers).toBeNull();
  });

  it('resolves config with secret references', async () => {
    repo.findById.mockResolvedValue(
      makeServerRecord({
        headers: { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyId: 'k1' },
        args: ['--tok', '{{secret:key}}'],
      }),
    );
    encryption.decryptHeaders.mockResolvedValue({ Authorization: 'Bearer raw' });
    secretResolver.resolveMcpConfig.mockResolvedValue({
      headers: { Authorization: 'Bearer resolved' },
      args: ['--tok', 'real'],
    });
    const result = await service.getResolvedConfig(authContext, 'server-1');
    expect(result.headers).toEqual({ Authorization: 'Bearer resolved' });
    expect(result.args).toEqual(['--tok', 'real']);
  });

  // ── Organization context ──────────────────────────────────────────
  it('throws ForbiddenException when auth is null', async () => {
    await expect(service.listServers(null)).rejects.toThrow(ForbiddenException);
  });
});
