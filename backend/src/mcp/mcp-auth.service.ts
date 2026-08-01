import { Injectable, Inject, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { QueryNotRegisteredError } from '@temporalio/client';
import {
  INSTALL_TOOL_INVOCATION_MANIFEST_UPDATE_NAME,
  TOOL_INVOCATION_PROTOCOL_QUERY_NAME,
  TOOL_INVOCATION_PROTOCOL_VERSION,
} from '@sentris/shared';
import { TOOL_REGISTRY_REDIS } from './tool-registry.service';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { normalizeRunMcpAllowedNodeIds } from './run-mcp-request-context';
import { TemporalService } from '../temporal/temporal.service';
import { McpRunAuthorityService } from '../mcp-runtime/mcp-run-authority.service';

export interface McpSessionMetadata {
  runId: string;
  organizationId: string | null;
  agentId?: string;
  allowedNodeIds?: string[];
  capabilityGrantId?: string;
  capabilitySnapshotId?: string;
  invokingNodeId?: string;
  expiresAt: number;
}

@Injectable()
export class McpAuthService {
  private readonly logger = new Logger(McpAuthService.name);
  private readonly TOKEN_PREFIX = 'mcp:session:';
  private readonly DEFAULT_TOKEN_TTL_SECONDS = 60 * 60;
  private readonly MIN_TOKEN_TTL_SECONDS = 60;
  private readonly MAX_TOKEN_TTL_SECONDS = 3 * 60 * 60;

  constructor(
    @Inject(TOOL_REGISTRY_REDIS) private readonly redis: Redis,
    private readonly temporalService: TemporalService,
    private readonly runAuthority: McpRunAuthorityService,
  ) {}

  /**
   * Generate a secure, short-lived session token for an MCP agent
   */
  async generateSessionToken(
    runId: string,
    organizationId: string | null,
    agentId = 'agent',
    allowedNodeIds?: string[],
    ttlSeconds = this.DEFAULT_TOKEN_TTL_SECONDS,
    invokingNodeId?: string,
  ): Promise<string> {
    const normalizedTtlSeconds =
      typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds)
        ? Math.trunc(ttlSeconds)
        : this.DEFAULT_TOKEN_TTL_SECONDS;
    const boundedTtlSeconds = Math.min(
      this.MAX_TOKEN_TTL_SECONDS,
      Math.max(this.MIN_TOKEN_TTL_SECONDS, normalizedTtlSeconds),
    );
    const normalizedAllowedNodeIds = normalizeRunMcpAllowedNodeIds(allowedNodeIds);
    let authority: Awaited<ReturnType<McpRunAuthorityService['materialize']>> | undefined;
    let useLegacyProtocol = false;
    try {
      const version = await this.temporalService.queryWorkflow<number>({
        workflowId: runId,
        queryType: TOOL_INVOCATION_PROTOCOL_QUERY_NAME,
      });
      if (version !== TOOL_INVOCATION_PROTOCOL_VERSION) {
        throw new Error(`Unsupported tool invocation protocol version: ${version}`);
      }
    } catch (error) {
      if (!(error instanceof QueryNotRegisteredError)) throw error;
      useLegacyProtocol = true;
    }

    if (!useLegacyProtocol) {
      authority = await this.runAuthority.materialize({
        runId,
        organizationId,
        ...(invokingNodeId !== undefined && { invokingNodeId }),
        allowedNodeIds: normalizedAllowedNodeIds,
      });
      await this.temporalService.executeWorkflowUpdate<undefined>({
        workflowId: runId,
        updateName: INSTALL_TOOL_INVOCATION_MANIFEST_UPDATE_NAME,
        updateId: `install-manifest:${authority.grant.id}`,
        args: {
          scope: authority.snapshot.scope,
          manifest: authority.manifest,
        },
      });
    }

    const token = `mcp_sk_${randomUUID().replace(/-/g, '')}`;
    const expiresAt = Math.floor(Date.now() / 1000) + boundedTtlSeconds;
    const capabilityGrantId = authority?.grant.id ?? randomUUID();

    const metadata: McpSessionMetadata = {
      runId,
      organizationId,
      agentId,
      allowedNodeIds: normalizedAllowedNodeIds,
      capabilityGrantId,
      ...(authority !== undefined && { capabilitySnapshotId: authority.snapshot.id }),
      ...(invokingNodeId !== undefined && { invokingNodeId }),
      expiresAt,
    };

    await this.redis.set(
      `${this.TOKEN_PREFIX}${token}`,
      JSON.stringify(metadata),
      'EX',
      boundedTtlSeconds,
    );

    return token;
  }

  /**
   * Validate a session token and return the corresponding AuthInfo
   */
  async validateToken(token: string): Promise<AuthInfo | null> {
    const data = await this.redis.get(`${this.TOKEN_PREFIX}${token}`);
    if (!data) {
      return null;
    }

    try {
      const metadata: McpSessionMetadata = JSON.parse(data);
      const allowedNodeIds = normalizeRunMcpAllowedNodeIds(metadata.allowedNodeIds);
      const capabilityGrantId =
        metadata.capabilityGrantId ??
        this.deriveLegacyCapabilityGrantId(token, metadata, allowedNodeIds);

      // Map to MCP Spec AuthInfo
      return {
        token,
        clientId: metadata.agentId || 'unknown-agent',
        scopes: ['tools:list', 'tools:call', 'resources:list'],
        expiresAt: metadata.expiresAt,
        extra: {
          runId: metadata.runId,
          organizationId: metadata.organizationId,
          capabilityGrantId,
          ...(metadata.capabilitySnapshotId !== undefined && {
            capabilitySnapshotId: metadata.capabilitySnapshotId,
          }),
          ...(metadata.invokingNodeId !== undefined && {
            invokingNodeId: metadata.invokingNodeId,
          }),
          allowedNodeIds,
        },
      };
    } catch (err) {
      this.logger.error(`Failed to parse MCP session metadata: ${err}`);
      return null;
    }
  }

  /**
   * Revoke a specific session token
   */
  async revokeToken(token: string): Promise<void> {
    await this.redis.del(`${this.TOKEN_PREFIX}${token}`);
  }

  private deriveLegacyCapabilityGrantId(
    token: string,
    metadata: McpSessionMetadata,
    allowedNodeIds: string[],
  ): string {
    const canonicalTuple = [
      1,
      token,
      metadata.runId,
      metadata.organizationId,
      metadata.agentId ?? null,
      allowedNodeIds,
    ];
    const bytes = createHash('sha256')
      .update(JSON.stringify(canonicalTuple))
      .digest()
      .subarray(0, 16);
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
