import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  CapabilityGrantSchema,
  MCP_CAPABILITY_CONTRACT_VERSION,
  McpCapabilityCatalogSnapshotSchema,
  McpOperationInvocationRequestSchema,
  buildInvocationManifest,
  type McpOperation,
  type McpOperationInvocationRequest,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { McpSavedServerRuntimeService } from '../mcp-servers/mcp-saved-server-runtime.service';
import { McpServerRuntimeConfigService } from '../mcp-servers/mcp-server-runtime-config.service';
import { McpServersService } from '../mcp-servers/mcp-servers.service';
import { stableMcpAuthorityUuid } from '../mcp-runtime/mcp-authority-identity';
import { sha256 } from '../mcp-runtime/mcp-binding-fingerprint';
import {
  McpRuntimeRepository,
  type StoredMcpAuthority,
} from '../mcp-runtime/mcp-runtime.repository';

const OPERATOR_MCP_AUTHORITY_TTL_MS = 24 * 60 * 60_000;
const OPERATOR_MCP_INVOCATION_TTL_MS = 10 * 60_000;

@Injectable()
export class OperatorMcpAuthorityService {
  constructor(
    private readonly servers: McpServersService,
    private readonly runtimeConfig: McpServerRuntimeConfigService,
    private readonly discovery: McpSavedServerRuntimeService,
    private readonly repository: McpRuntimeRepository,
  ) {}

  async listServers(auth: AuthContext, search: string | undefined, limit: number) {
    const servers = await this.servers.listServers(auth);
    const normalizedSearch = search?.toLowerCase();
    return servers
      .filter((server) =>
        normalizedSearch
          ? server.name.toLowerCase().includes(normalizedSearch) ||
            server.description?.toLowerCase().includes(normalizedSearch)
          : true,
      )
      .slice(0, limit)
      .map((server) => ({
        id: server.id,
        name: server.name,
        description: server.description,
        transportType: server.transportType,
        enabled: server.enabled,
        health: server.lastHealthStatus ?? 'unknown',
      }));
  }

  async materialize(input: {
    auth: AuthContext;
    sessionId: string;
    turnId: string;
    turnCreatedAt: string;
    serverId: string;
  }): Promise<{ authority: StoredMcpAuthority; server: { id: string; name: string } }> {
    if (!input.auth.organizationId) throw new ForbiddenException('Organization context required');
    const createdAt = new Date(input.turnCreatedAt);
    if (!Number.isFinite(createdAt.getTime())) {
      throw new ConflictException('Operator turn creation time is invalid');
    }

    const server = await this.servers.getServer(input.auth, input.serverId);
    const runtimeKey = await this.runtimeConfig.buildRuntimeKey(input.auth, input.serverId);
    const catalog = await this.discovery.discover(runtimeKey);
    this.assertSingleServerCatalog(input.serverId, catalog);

    const expiresAt = new Date(createdAt.getTime() + OPERATOR_MCP_AUTHORITY_TTL_MS).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) {
      throw new ForbiddenException('Operator turn is too old to grant MCP capabilities');
    }
    const configFingerprint = sha256({
      version: 1,
      runtimeKey,
      capabilityFingerprint: catalog.capabilityFingerprint,
    });
    const authorityKey = sha256({
      version: 1,
      kind: 'operator',
      organizationId: input.auth.organizationId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      serverId: input.serverId,
      configFingerprint,
    });
    const grantId = stableMcpAuthorityUuid('mcp-operator-grant', authorityKey);
    const snapshotId = stableMcpAuthorityUuid('mcp-operator-snapshot', authorityKey);
    const scope = {
      kind: 'operator' as const,
      organizationId: input.auth.organizationId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      capabilityGrantId: grantId,
      expiresAt,
    };
    const grant = CapabilityGrantSchema.parse({
      id: grantId,
      organizationId: input.auth.organizationId,
      subject: {
        kind: 'operator',
        sessionId: input.sessionId,
        turnId: input.turnId,
        expiresAt,
      },
      sources: [{ sourceId: input.serverId, toolAccess: { mode: 'all' } }],
      createdAt: createdAt.toISOString(),
    });
    const snapshot = McpCapabilityCatalogSnapshotSchema.parse({
      id: snapshotId,
      scope,
      version: MCP_CAPABILITY_CONTRACT_VERSION,
      configFingerprint,
      runtimeBindings: {
        [input.serverId]: {
          runtimeKey,
          protocolEra: catalog.protocolEra,
          protocolVersion: catalog.protocolVersion,
          capabilityFingerprint: catalog.capabilityFingerprint,
        },
      },
      tools: catalog.tools,
      resources: catalog.resources,
      resourceTemplates: catalog.resourceTemplates,
      prompts: catalog.prompts,
      createdAt: createdAt.toISOString(),
    });
    const authority = await this.repository.createOrReadAuthority({
      authorityKey,
      grant,
      snapshot,
      manifest: buildInvocationManifest(snapshot, grant),
    });
    return { authority, server: { id: server.id, name: server.name } };
  }

  async createOperationRequest(input: {
    organizationId: string;
    sessionId: string;
    turnId: string;
    actionId: string;
    actionRequestedAt: string;
    capabilitySnapshotId: string;
    sourceId: string;
    authorizationTarget: string;
    operation: McpOperation;
  }): Promise<McpOperationInvocationRequest> {
    const authority = await this.repository.getOperatorAuthority({
      capabilitySnapshotId: input.capabilitySnapshotId,
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      turnId: input.turnId,
    });
    if (!authority) throw new ForbiddenException('Operator MCP capability snapshot was not found');
    const scope = authority.snapshot.scope;
    const subject = authority.grant.subject;
    if (
      scope.kind !== 'operator' ||
      subject.kind !== 'operator' ||
      scope.organizationId !== input.organizationId ||
      scope.sessionId !== input.sessionId ||
      scope.turnId !== input.turnId ||
      subject.sessionId !== input.sessionId ||
      subject.turnId !== input.turnId ||
      Date.parse(scope.expiresAt) <= Date.now()
    ) {
      throw new ForbiddenException('Operator MCP capability snapshot is outside this turn');
    }
    const requestedAt = new Date(input.actionRequestedAt);
    if (!Number.isFinite(requestedAt.getTime())) {
      throw new ConflictException('Operator MCP action time is invalid');
    }
    const authorityExpiresAt = Date.parse(scope.expiresAt);
    const deadlineAt = Math.min(
      requestedAt.getTime() + OPERATOR_MCP_INVOCATION_TTL_MS,
      authorityExpiresAt,
    );
    if (requestedAt.getTime() >= deadlineAt) {
      throw new ForbiddenException('Operator MCP capability snapshot has expired');
    }
    return McpOperationInvocationRequestSchema.parse({
      invocationId: input.actionId,
      scope,
      capabilitySnapshotId: authority.snapshot.id,
      sourceId: input.sourceId,
      authorizationTarget: input.authorizationTarget,
      operation: input.operation,
      requestedAt: requestedAt.toISOString(),
      deadlineAt: new Date(deadlineAt).toISOString(),
    });
  }

  private assertSingleServerCatalog(
    serverId: string,
    catalog: {
      tools: readonly { source: { sourceId: string } }[];
      resources: readonly { sourceId: string }[];
      resourceTemplates: readonly { sourceId: string }[];
      prompts: readonly { sourceId: string }[];
    },
  ): void {
    const sourceIds = [
      ...catalog.tools.map((descriptor) => descriptor.source.sourceId),
      ...catalog.resources.map((descriptor) => descriptor.sourceId),
      ...catalog.resourceTemplates.map((descriptor) => descriptor.sourceId),
      ...catalog.prompts.map((descriptor) => descriptor.sourceId),
    ];
    if (sourceIds.some((sourceId) => sourceId !== serverId)) {
      throw new ConflictException('MCP discovery crossed its saved-server source boundary');
    }
  }
}
