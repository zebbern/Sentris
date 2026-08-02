import { describe, expect, it, vi } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { McpSavedServerDiscoveryService } from '../../mcp-servers/mcp-saved-server-discovery.service';
import type { McpServerRuntimeConfigService } from '../../mcp-servers/mcp-server-runtime-config.service';
import type { McpServersService } from '../../mcp-servers/mcp-servers.service';
import type { McpRuntimeRepository } from '../../mcp-runtime/mcp-runtime.repository';
import { OperatorMcpAuthorityService } from '../operator-mcp-authority.service';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID = '33333333-3333-4333-8333-333333333333';
const ACTION_ID = '44444444-4444-4444-8444-444444444444';

const auth: AuthContext = {
  userId: 'operator-user',
  organizationId: 'operator-org',
  roles: ['MEMBER'],
  isAuthenticated: true,
  provider: 'operator',
};

const runtimeKey = {
  sourceId: SERVER_ID,
  transport: 'http' as const,
  configFingerprint: 'a'.repeat(64),
  organizationId: 'operator-org',
  principalPartitionHash: 'b'.repeat(64),
  credentialReference: null,
  credentialGeneration: null,
};

const catalog = {
  protocolEra: 'modern' as const,
  protocolVersion: '2026-07-28',
  capabilityFingerprint: 'c'.repeat(64),
  tools: [
    {
      canonicalName: 'search',
      displayName: 'Search',
      inputSchema: { type: 'object' },
      source: {
        kind: 'mcp' as const,
        sourceId: SERVER_ID,
        serverId: SERVER_ID,
        upstreamName: 'search',
        bindingFingerprint: 'd'.repeat(64),
      },
      effects: 'unknown' as const,
      effectsSource: 'mcp-annotation' as const,
      retryPolicy: 'pre-dispatch-only' as const,
    },
  ],
  resources: [],
  resourceTemplates: [],
  prompts: [],
};

function createService() {
  const servers = {
    getServer: vi.fn().mockResolvedValue({ id: SERVER_ID, name: 'Research MCP' }),
    listServers: vi.fn(),
  };
  const runtimeConfig = { buildRuntimeKey: vi.fn().mockResolvedValue(runtimeKey) };
  const discovery = { discover: vi.fn().mockResolvedValue(catalog) };
  const repository = {
    createOrReadAuthority: vi.fn(async (value) => ({
      grant: value.grant,
      snapshot: value.snapshot,
      manifest: value.manifest,
    })),
    getOperatorAuthority: vi.fn(),
  };
  return {
    service: new OperatorMcpAuthorityService(
      servers as unknown as McpServersService,
      runtimeConfig as unknown as McpServerRuntimeConfigService,
      discovery as unknown as McpSavedServerDiscoveryService,
      repository as unknown as McpRuntimeRepository,
    ),
    repository,
  };
}

describe('OperatorMcpAuthorityService', () => {
  it('materializes deterministic immutable authority for one saved server and turn', async () => {
    const { service } = createService();
    const turnCreatedAt = new Date().toISOString();
    const first = await service.materialize({
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt,
      serverId: SERVER_ID,
    });
    const second = await service.materialize({
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt,
      serverId: SERVER_ID,
    });

    expect(second.authority).toEqual(first.authority);
    expect(first.authority.snapshot.scope).toEqual(
      expect.objectContaining({
        kind: 'operator',
        organizationId: 'operator-org',
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      }),
    );
    expect(first.authority.manifest.entries).toContainEqual(
      expect.objectContaining({
        operationKind: 'tool-call',
        operationTarget: 'search',
        sourceId: SERVER_ID,
        destination: 'mcp-activity',
      }),
    );
  });

  it('reuses the action ID and clamps dispatch to the turn authority expiry', async () => {
    const { service, repository } = createService();
    const turnCreatedAt = new Date(Date.now() - 23 * 60 * 60_000 - 55 * 60_000).toISOString();
    const { authority } = await service.materialize({
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt,
      serverId: SERVER_ID,
    });
    repository.getOperatorAuthority.mockResolvedValue(authority);
    const actionRequestedAt = new Date().toISOString();

    const request = await service.createOperationRequest({
      organizationId: 'operator-org',
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      actionId: ACTION_ID,
      actionRequestedAt,
      capabilitySnapshotId: authority.snapshot.id,
      sourceId: SERVER_ID,
      authorizationTarget: 'search',
      operation: { kind: 'tool-call', name: 'search', arguments: {} },
    });

    expect(request.invocationId).toBe(ACTION_ID);
    expect(request.deadlineAt).toBe(
      authority.snapshot.scope.kind === 'operator' ? authority.snapshot.scope.expiresAt : undefined,
    );
  });
});
