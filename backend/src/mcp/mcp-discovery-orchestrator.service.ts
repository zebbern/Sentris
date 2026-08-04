import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  Inject,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

import { TemporalService } from '../temporal/temporal.service';
import type {
  GroupDiscoveryInputDto,
  GroupDiscoveryStartResponseDto,
  GroupDiscoveryStatusDto,
} from './dto/mcp-discovery.dto';
import { MCP_DISCOVERY_REDIS } from './mcp.tokens';
import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';

const DISCOVERY_CACHE_TTL_SECONDS = 300;
const DISCOVERY_OWNER_TTL_SECONDS = 60 * 60;

@Injectable()
export class McpDiscoveryOrchestratorService implements OnModuleDestroy {
  private readonly logger = new Logger(McpDiscoveryOrchestratorService.name);

  constructor(
    private readonly temporalService: TemporalService,
    @Inject(MCP_DISCOVERY_REDIS) private readonly redis: Redis,
  ) {}

  async onModuleDestroy(): Promise<void> {
    // Best-effort shutdown.
    try {
      await this.redis.quit();
    } catch {
      // ignore
    }
  }

  private requireDiscoveryAdmin(auth: AuthContext | null): string {
    const organizationId = requireOrganizationId(auth);
    if (!auth?.isAuthenticated || !auth.roles.includes('ADMIN')) {
      throw new ForbiddenException('Administrator role required');
    }
    return organizationId;
  }

  private ownerKey(workflowId: string): string {
    return `mcp-discovery:workflow:${workflowId}`;
  }

  private cacheKey(cacheToken: string): string {
    return `mcp-discovery:${cacheToken}`;
  }

  private async deleteGeneratedKeys(keys: string[], originalFailure: unknown): Promise<void> {
    try {
      await this.redis.del(...keys);
    } catch (cleanupFailure) {
      throw new AggregateError(
        [originalFailure, cleanupFailure],
        'MCP discovery startup failed and Redis compensation was incomplete',
      );
    }
  }

  private async storePendingRecords(
    records: { key: string; ttlSeconds: number; value: string }[],
  ): Promise<string[]> {
    const keys = records.map(({ key }) => key);
    const writes = await Promise.allSettled(
      records.map(({ key, ttlSeconds, value }) =>
        Promise.resolve().then(() => this.redis.setex(key, ttlSeconds, value)),
      ),
    );
    const failedWrite = writes.find(
      (write): write is PromiseRejectedResult => write.status === 'rejected',
    );
    if (failedWrite) {
      await this.deleteGeneratedKeys(keys, failedWrite.reason);
      throw failedWrite.reason;
    }
    return keys;
  }

  private async assertWorkflowOwner(workflowId: string, auth: AuthContext | null): Promise<void> {
    const organizationId = this.requireDiscoveryAdmin(auth);
    const value = await this.redis.get(this.ownerKey(workflowId));
    if (!value) {
      throw new ForbiddenException('Discovery workflow access denied');
    }

    try {
      const owner = JSON.parse(value) as { organizationId?: string };
      if (owner.organizationId !== organizationId) {
        throw new ForbiddenException('Discovery workflow access denied');
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new ForbiddenException('Discovery workflow access denied');
    }
  }

  async startGroupDiscovery(
    input: GroupDiscoveryInputDto,
    auth: AuthContext | null,
  ): Promise<GroupDiscoveryStartResponseDto> {
    const organizationId = this.requireDiscoveryAdmin(auth);
    const workflowId = randomUUID();
    const cacheTokens: Record<string, string> = {};

    const serverNames = input.servers.map((server) => server.name);
    const uniqueNames = new Set(serverNames);
    if (uniqueNames.size !== serverNames.length) {
      throw new BadRequestException('Server names must be unique for group discovery');
    }

    for (const server of input.servers) {
      cacheTokens[server.name] = randomUUID();
    }

    this.logger.log(
      `Starting MCP group discovery workflow ${workflowId} for ${input.servers.length} server(s)`,
    );

    const generatedKeys = await this.storePendingRecords([
      ...Object.values(cacheTokens).map((cacheToken) => ({
        key: this.cacheKey(cacheToken),
        ttlSeconds: DISCOVERY_CACHE_TTL_SECONDS,
        value: JSON.stringify({ status: 'pending', workflowId, organizationId }),
      })),
      {
        key: this.ownerKey(workflowId),
        ttlSeconds: DISCOVERY_OWNER_TTL_SECONDS,
        value: JSON.stringify({ organizationId }),
      },
    ]);

    try {
      await this.temporalService.startWorkflow({
        workflowType: 'mcpGroupDiscoveryWorkflow',
        workflowId,
        taskQueue: this.temporalService.getDefaultTaskQueue(),
        args: [{ ...input, cacheTokens }],
      });
    } catch (error) {
      await this.deleteGeneratedKeys(generatedKeys, error);
      throw error;
    }

    return { workflowId, cacheTokens, status: 'started' };
  }

  async getGroupStatus(
    workflowId: string,
    auth: AuthContext | null,
  ): Promise<GroupDiscoveryStatusDto> {
    this.logger.debug(`Querying MCP group discovery status for workflow ${workflowId}`);
    await this.assertWorkflowOwner(workflowId, auth);

    const result = await this.temporalService.queryWorkflow<{
      status: 'running' | 'completed' | 'failed';
      results?: {
        name: string;
        status: 'running' | 'completed' | 'failed';
        tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
        toolCount?: number;
        error?: string;
        cacheToken?: string;
      }[];
      error?: string;
      errorCode?: string;
    }>({
      workflowId,
      queryType: 'getGroupDiscoveryResult',
    });

    if (!result) {
      return { workflowId, status: 'running' };
    }

    return {
      workflowId,
      status: result.status,
      results: result.results,
      error: result.error,
      errorCode: result.errorCode,
    };
  }
}
