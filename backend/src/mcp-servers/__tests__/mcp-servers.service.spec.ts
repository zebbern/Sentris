import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { McpServersService } from '../mcp-servers.service';
import type { McpServersRepository } from '../mcp-servers.repository';
import type { McpServersEncryptionService } from '../mcp-servers.encryption';
import type { SecretResolver } from '../../secrets/secret-resolver';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { AuthContext } from '../../auth/types';
import type { McpServerRecord, McpServerToolRecord } from '../../database/schema';
import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';

const now = new Date('2024-06-01T00:00:00.000Z');
const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

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
    enabled: true,
    healthCheckUrl: null,
    lastHealthCheck: null,
    lastHealthStatus: null,
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
  let configSvc: Record<string, ReturnType<typeof vi.fn>>;
  let redis: Record<string, ReturnType<typeof vi.fn>>;
  let service: McpServersService;

  beforeEach(() => {
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
      toggleToolEnabled: vi.fn(),
      clearTools: vi.fn(),
    };
    encryption = { encryptHeaders: vi.fn(), decryptHeaders: vi.fn() };
    secretResolver = { resolveMcpConfig: vi.fn() };
    auditLog = { record: vi.fn() };
    configSvc = { get: vi.fn() };
    redis = { get: vi.fn(), del: vi.fn() };

    service = new McpServersService(
      repo as unknown as McpServersRepository,
      encryption as unknown as McpServersEncryptionService,
      secretResolver as unknown as SecretResolver,
      redis as any,
      null,
      auditLog as unknown as AuditLogService,
      configSvc as any,
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
    repo.create.mockResolvedValue(makeServerRecord());
    const result = await service.createServer(authContext, {
      name: 'test-mcp-server',
      transportType: 'http',
      endpoint: 'http://localhost:3100/mcp',
    });
    expect(result.id).toBe('server-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test-mcp-server', transportType: 'http' }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      authContext,
      expect.objectContaining({ action: 'mcp_server.create' }),
    );
  });

  it('encrypts headers when creating a server', async () => {
    repo.list.mockResolvedValue([]);
    repo.create.mockResolvedValue(
      makeServerRecord({ headers: { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyId: 'k1' } }),
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
    repo.create.mockResolvedValue(makeServerRecord());
    repo.upsertTools.mockResolvedValue([]);
    repo.updateHealthStatus.mockResolvedValue(undefined);
    redis.get.mockResolvedValue(
      JSON.stringify({
        status: 'completed',
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

  // ── Update ────────────────────────────────────────────────────────
  it('updates server name and description', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    repo.update.mockResolvedValue(makeServerRecord({ name: 'renamed', description: 'new' }));
    const result = await service.updateServer(authContext, 'server-1', {
      name: 'renamed',
      description: 'new',
    });
    expect(result.name).toBe('renamed');
    expect(auditLog.record).toHaveBeenCalledWith(
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
    repo.update.mockResolvedValue(makeServerRecord());
    encryption.encryptHeaders.mockResolvedValue({
      ciphertext: 'ct2',
      iv: 'iv2',
      authTag: 'tag2',
      keyId: 'k2',
    });
    await service.updateServer(authContext, 'server-1', { headers: { 'X-Key': 'secret' } });
    expect(encryption.encryptHeaders).toHaveBeenCalledWith({ 'X-Key': 'secret' });
  });

  it('clears headers when null is provided', async () => {
    repo.findById.mockResolvedValue(
      makeServerRecord({ headers: { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyId: 'k1' } }),
    );
    repo.update.mockResolvedValue(makeServerRecord());
    await service.updateServer(authContext, 'server-1', { headers: null });
    expect(repo.update).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({ headers: null }),
      expect.any(Object),
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
    repo.update.mockResolvedValue(makeServerRecord({ enabled: false }));
    const result = await service.toggleServer(authContext, 'server-1');
    expect(result.enabled).toBe(false);
  });

  it('deletes a server and records audit log', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    repo.delete.mockResolvedValue(undefined);
    await service.deleteServer(authContext, 'server-1');
    expect(repo.delete).toHaveBeenCalledWith('server-1', {
      organizationId: DEFAULT_ORGANIZATION_ID,
    });
    expect(auditLog.record).toHaveBeenCalledWith(
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

  it('lists all tools across enabled servers', async () => {
    repo.listAllToolsForOrganization.mockResolvedValue([
      { ...makeToolRecord(), serverName: 'srv' },
    ]);
    const result = await service.getAllTools(authContext);
    expect(result).toHaveLength(1);
  });

  it('toggles tool enabled state', async () => {
    repo.findById.mockResolvedValue(makeServerRecord());
    repo.toggleToolEnabled.mockResolvedValue(makeToolRecord({ enabled: false }));
    const result = await service.toggleToolEnabled(authContext, 'server-1', 'tool-1');
    expect(result.enabled).toBe(false);
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
  it('falls back to default organization when auth is null', async () => {
    repo.list.mockResolvedValue([]);
    const result = await service.listServers(null);
    expect(result).toEqual([]);
    expect(repo.list).toHaveBeenCalledWith({
      organizationId: DEFAULT_ORGANIZATION_ID,
      groupId: undefined,
    });
  });
});
