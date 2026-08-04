import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { McpServerRecord } from '../../database/schema';
import { SecretResolver } from '../../secrets/secret-resolver';
import type { SecretsService } from '../../secrets/secrets.service';
import { McpServerRuntimeConfigService } from '../mcp-server-runtime-config.service';
import type { McpServersEncryptionService } from '../mcp-servers.encryption';
import type { McpServersRepository } from '../mcp-servers.repository';

const auth: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};
const SECRET_ID = '00000000-0000-4000-8000-000000000001';

function record(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'server-1',
    name: 'Reference MCP',
    description: null,
    transportType: 'http',
    endpoint: 'https://mcp.example.test/mcp',
    command: null,
    args: null,
    headers: {
      ciphertext: 'encrypted-bearer-token',
      iv: 'iv',
      authTag: 'tag',
      keyId: 'key-1',
    },
    headerSecretReferences: [SECRET_ID],
    argSecretReferences: [],
    enabled: true,
    healthCheckUrl: null,
    lastHealthCheck: null,
    lastHealthStatus: null,
    capabilityCatalog: null,
    capabilityCatalogDiscoveredAt: null,
    groupId: null,
    registrySourceName: null,
    organizationId: 'org-1',
    createdBy: 'user-1',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T01:02:03.004Z'),
    ...overrides,
  };
}

describe('McpServerRuntimeConfigService', () => {
  let current: McpServerRecord;
  let repository: { findById: ReturnType<typeof vi.fn> };
  let encryption: { decryptHeaders: ReturnType<typeof vi.fn> };
  let resolver: { resolveMcpConfig: ReturnType<typeof vi.fn> };
  let secrets: {
    getSecret: ReturnType<typeof vi.fn>;
    getSecretValue: ReturnType<typeof vi.fn>;
    listSecrets: ReturnType<typeof vi.fn>;
  };
  let secretVersion: number;
  let service: McpServerRuntimeConfigService;

  beforeEach(() => {
    current = record();
    repository = {
      findById: vi.fn(async () => current),
    };
    encryption = {
      decryptHeaders: vi.fn(async () => ({ Authorization: 'Bearer resolved-secret' })),
    };
    resolver = {
      resolveMcpConfig: vi.fn(async (headers, args) => ({ headers, args })),
    };
    secretVersion = 3;
    secrets = {
      getSecret: vi.fn(async (authContext, id) => ({
        id,
        name: 'MCP token',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        activeVersion: {
          id: 'version-3',
          version: secretVersion,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          createdBy: null,
        },
      })),
      getSecretValue: vi.fn(async (_authContext, id, version) => ({
        secretId: id,
        version: version ?? secretVersion,
        value: `value-v${version ?? secretVersion}`,
      })),
      listSecrets: vi.fn(async () => []),
    };
    service = new McpServerRuntimeConfigService(
      repository as unknown as McpServersRepository,
      encryption as unknown as McpServersEncryptionService,
      resolver as unknown as SecretResolver,
      secrets as unknown as SecretsService,
    );
  });

  it('builds a stable secret-free runtime key without decrypting configuration', async () => {
    const key = await service.buildRuntimeKey(auth, current.id);

    expect(key).toMatchObject({
      sourceId: current.id,
      transport: 'http',
      organizationId: 'org-1',
      credentialReference: `mcp-server:${current.id}`,
    });
    expect(key.credentialGeneration).toBeGreaterThan(0);
    expect(key.configFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(key.principalPartitionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(key)).not.toContain('resolved-secret');
    expect(JSON.stringify(key)).not.toContain('encrypted-bearer-token');
    expect(encryption.decryptHeaders).not.toHaveBeenCalled();
    expect(resolver.resolveMcpConfig).not.toHaveBeenCalled();
    expect(secrets.getSecret).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', provider: 'internal' }),
      SECRET_ID,
    );
  });

  it('partitions otherwise identical runtime keys by caller authorization context', async () => {
    const first = await service.buildRuntimeKey(auth, current.id);
    const second = await service.buildRuntimeKey(
      { ...auth, userId: 'user-2', roles: ['MEMBER'] },
      current.id,
    );

    expect(second.configFingerprint).toBe(first.configFingerprint);
    expect(second.credentialGeneration).toBe(first.credentialGeneration);
    expect(second.principalPartitionHash).not.toBe(first.principalPartitionHash);
    expect(encryption.decryptHeaders).not.toHaveBeenCalled();
    expect(resolver.resolveMcpConfig).not.toHaveBeenCalled();
  });

  it('resolves credentials only for the exact current runtime identity', async () => {
    const key = await service.buildRuntimeKey(auth, current.id);
    const definition = await service.resolveDefinition(key);

    expect(definition).toEqual({
      sourceId: current.id,
      configFingerprint: key.configFingerprint,
      bindingFingerprint: key.configFingerprint,
      kind: 'remote-http',
      endpoint: 'https://mcp.example.test/mcp',
      headers: { Authorization: 'Bearer resolved-secret' },
      allowedInternalHosts: ['mcp.example.test'],
    });
    expect(encryption.decryptHeaders).toHaveBeenCalledTimes(1);
    expect(resolver.resolveMcpConfig).toHaveBeenCalledTimes(1);
  });

  it('keeps runtime identity stable across health-only timestamp changes', async () => {
    const key = await service.buildRuntimeKey(auth, current.id);
    current = record({ updatedAt: new Date(current.updatedAt.getTime() + 1) });

    const afterHealthUpdate = await service.buildRuntimeKey(auth, current.id);

    expect(afterHealthUpdate).toEqual(key);
  });

  it('rejects stale execution configuration before decrypting secrets', async () => {
    const key = await service.buildRuntimeKey(auth, current.id);
    current = record({ endpoint: 'https://new-mcp.example.test/mcp' });

    await expect(service.resolveDefinition(key)).rejects.toBeInstanceOf(ForbiddenException);
    expect(encryption.decryptHeaders).not.toHaveBeenCalled();
    expect(resolver.resolveMcpConfig).not.toHaveBeenCalled();
  });

  it('changes generation when a referenced secret rotates and rejects the stale key', async () => {
    const key = await service.buildRuntimeKey(auth, current.id);
    secretVersion = 4;

    const rotated = await service.buildRuntimeKey(auth, current.id);

    expect(rotated.credentialGeneration).not.toBe(key.credentialGeneration);
    await expect(service.resolveDefinition(key)).rejects.toBeInstanceOf(ForbiddenException);
    expect(encryption.decryptHeaders).not.toHaveBeenCalled();
  });

  it('pins resolved values to the secret versions used by the runtime identity', async () => {
    let metadataReads = 0;
    secrets.getSecret.mockImplementation(async (_authContext, id) => {
      const reportedVersion = secretVersion;
      metadataReads += 1;
      if (metadataReads === 2) secretVersion = 4;
      return {
        id,
        name: 'MCP token',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        activeVersion: {
          id: `version-${reportedVersion}`,
          version: reportedVersion,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          createdBy: null,
        },
      };
    });
    encryption.decryptHeaders.mockResolvedValue({
      Authorization: `Bearer {{secret:${SECRET_ID}}}`,
    });
    service = new McpServerRuntimeConfigService(
      repository as unknown as McpServersRepository,
      encryption as unknown as McpServersEncryptionService,
      new SecretResolver(secrets as unknown as SecretsService),
      secrets as unknown as SecretsService,
    );

    const key = await service.buildRuntimeKey(auth, current.id);
    const definition = await service.resolveDefinition(key);

    expect(definition).toMatchObject({
      kind: 'remote-http',
      headers: { Authorization: 'Bearer value-v3' },
    });
  });

  it('rejects null-owned legacy servers for hardened tenants', async () => {
    const previousProfile = process.env.SENTRIS_TRUST_PROFILE;
    process.env.SENTRIS_TRUST_PROFILE = 'hardened';
    current = record({ organizationId: null });

    try {
      await expect(service.buildRuntimeKey(auth, current.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    } finally {
      if (previousProfile === undefined) delete process.env.SENTRIS_TRUST_PROFILE;
      else process.env.SENTRIS_TRUST_PROFILE = previousProfile;
    }
  });

  it('keeps HTTP runtime identity independent of inactive stdio fields', async () => {
    const key = await service.buildRuntimeKey(auth, current.id);
    current = record({ command: 'unused-command', args: ['--unused'] });

    const withInactiveStdioFields = await service.buildRuntimeKey(auth, current.id);

    expect(withInactiveStdioFields).toEqual(key);
  });

  it('resolves encrypted env headers as active host-stdio credentials', async () => {
    current = record({
      transportType: 'stdio',
      endpoint: null,
      command: 'mcp-server',
      args: ['--stdio'],
      headerSecretReferences: [SECRET_ID],
      argSecretReferences: [],
    });
    encryption.decryptHeaders.mockResolvedValue({
      'env:MCP_TOKEN': `{{secret:${SECRET_ID}}}`,
    });
    resolver.resolveMcpConfig.mockResolvedValue({
      headers: { 'env:MCP_TOKEN': 'resolved-secret' },
      args: ['--stdio'],
    });

    const key = await service.buildRuntimeKey(auth, current.id);
    const definition = await service.resolveDefinition(key);

    expect(definition).toEqual({
      sourceId: current.id,
      configFingerprint: key.configFingerprint,
      bindingFingerprint: key.configFingerprint,
      kind: 'host-stdio',
      command: 'mcp-server',
      args: ['--stdio'],
      environment: { MCP_TOKEN: 'resolved-secret' },
    });
    expect(encryption.decryptHeaders).toHaveBeenCalledTimes(1);
    expect(resolver.resolveMcpConfig).toHaveBeenCalledWith(
      { 'env:MCP_TOKEN': `{{secret:${SECRET_ID}}}` },
      ['--stdio'],
      expect.anything(),
    );
    expect(secrets.getSecret).toHaveBeenCalledWith(expect.anything(), SECRET_ID);
  });

  it('includes encrypted stdio environment configuration in runtime identity', async () => {
    current = record({
      transportType: 'stdio',
      endpoint: null,
      command: 'mcp-server',
      args: [],
      headerSecretReferences: [],
      argSecretReferences: [],
    });
    const original = await service.buildRuntimeKey(auth, current.id);
    current = record({
      transportType: 'stdio',
      endpoint: null,
      command: 'mcp-server',
      args: [],
      headers: { ...current.headers!, ciphertext: 'rotated-encrypted-value' },
      headerSecretReferences: [],
      argSecretReferences: [],
    });

    const changed = await service.buildRuntimeKey(auth, current.id);

    expect(changed.configFingerprint).not.toBe(original.configFingerprint);
  });

  it('uses organization credential metadata only for legacy unindexed rows', async () => {
    current = record({ headerSecretReferences: null, argSecretReferences: null });
    secrets.listSecrets.mockResolvedValue([
      {
        id: SECRET_ID,
        name: 'MCP token',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        activeVersion: {
          id: 'version-3',
          version: 3,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          createdBy: null,
        },
      },
    ]);

    await service.buildRuntimeKey(auth, current.id);

    expect(secrets.listSecrets).toHaveBeenCalledTimes(1);
    expect(secrets.getSecret).not.toHaveBeenCalled();
    expect(encryption.decryptHeaders).not.toHaveBeenCalled();
  });

  it('normalizes the common docker run stdio form into an owned Docker runtime', async () => {
    current = record({
      transportType: 'stdio',
      endpoint: null,
      command: 'docker',
      args: ['run', '-i', '--rm', '-e', 'API_TOKEN={{secret:token-id}}', 'mcp/fetch', '--serve'],
      headers: null,
      headerSecretReferences: [],
      argSecretReferences: [],
    });
    resolver.resolveMcpConfig.mockResolvedValue({
      args: ['run', '-i', '--rm', '-e', 'API_TOKEN=resolved-value', 'mcp/fetch', '--serve'],
    });
    const key = await service.buildRuntimeKey(auth, current.id);

    await expect(service.resolveDefinition(key)).resolves.toEqual({
      sourceId: current.id,
      configFingerprint: key.configFingerprint,
      bindingFingerprint: key.configFingerprint,
      kind: 'docker-stdio',
      image: 'mcp/fetch',
      command: ['--serve'],
      environment: { API_TOKEN: 'resolved-value' },
    });
  });

  it('injects encrypted registry credentials into Docker stdio environment', async () => {
    current = record({
      transportType: 'stdio',
      endpoint: null,
      command: 'docker',
      args: ['run', '-i', '--rm', '-e', 'LOG_LEVEL=info', 'mcp/github'],
      headerSecretReferences: [],
      argSecretReferences: [],
    });
    encryption.decryptHeaders.mockResolvedValue({ 'env:GITHUB_TOKEN': 'encrypted-token' });
    resolver.resolveMcpConfig.mockResolvedValue({
      headers: { 'env:GITHUB_TOKEN': 'encrypted-token' },
      args: ['run', '-i', '--rm', '-e', 'LOG_LEVEL=info', 'mcp/github'],
    });
    const key = await service.buildRuntimeKey(auth, current.id);

    await expect(service.resolveDefinition(key)).resolves.toEqual({
      sourceId: current.id,
      configFingerprint: key.configFingerprint,
      bindingFingerprint: key.configFingerprint,
      kind: 'docker-stdio',
      image: 'mcp/github',
      environment: {
        LOG_LEVEL: 'info',
        GITHUB_TOKEN: 'encrypted-token',
      },
    });
  });

  it('preserves common Docker container options as a typed runtime definition', async () => {
    const dockerArgs = [
      'run',
      '-i',
      '--rm',
      '-v',
      'cache:/data:ro',
      '--volume=C:\\Work Space:/workspace',
      '--mount',
      'type=bind,src=/source path,dst=/workspace,readonly',
      '--mount=type=volume,src=mcp-cache,dst=/cache',
      '-w',
      '/workspace',
      '--user=1000:1000',
      '--entrypoint=',
      '--read-only',
      '--init=true',
      'example/mcp:latest',
      'serve',
      '--verbose',
    ];
    current = record({
      transportType: 'stdio',
      endpoint: null,
      command: 'docker',
      args: dockerArgs,
      headers: null,
      headerSecretReferences: [],
      argSecretReferences: [],
    });
    resolver.resolveMcpConfig.mockResolvedValue({ args: dockerArgs });
    const key = await service.buildRuntimeKey(auth, current.id);

    await expect(service.resolveDefinition(key)).resolves.toEqual({
      sourceId: current.id,
      configFingerprint: key.configFingerprint,
      bindingFingerprint: key.configFingerprint,
      kind: 'docker-stdio',
      image: 'example/mcp:latest',
      command: ['serve', '--verbose'],
      volumes: ['cache:/data:ro', 'C:\\Work Space:/workspace'],
      mounts: [
        'type=bind,src=/source path,dst=/workspace,readonly',
        'type=volume,src=mcp-cache,dst=/cache',
      ],
      workingDirectory: '/workspace',
      user: '1000:1000',
      entrypoint: '',
      readOnlyRootFilesystem: true,
      init: true,
    });
  });

  it('rejects unsupported Docker options instead of weakening runtime ownership', async () => {
    current = record({
      transportType: 'stdio',
      endpoint: null,
      command: 'docker',
      args: ['run', '--name', 'unmanaged', 'example/mcp:latest'],
      headers: null,
      headerSecretReferences: [],
      argSecretReferences: [],
    });
    resolver.resolveMcpConfig.mockResolvedValue({ args: current.args ?? [] });
    const key = await service.buildRuntimeKey(auth, current.id);

    await expect(service.resolveDefinition(key)).rejects.toThrow(
      "Unsupported Docker MCP run option '--name'",
    );
  });
});
