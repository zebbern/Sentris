import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ToolRegistryService, TOOL_REGISTRY_REDIS } from './tool-registry.service';
import { McpGatewayService } from './mcp-gateway.service';
import { McpAuthService } from './mcp-auth.service';
import { McpGatewayController } from './mcp-gateway.controller';
import { SecretsModule } from '../secrets/secrets.module';
import { InternalMcpController } from './internal-mcp.controller';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { McpDiscoveryController } from './mcp-discovery.controller';
import { TemporalModule } from '../temporal/temporal.module';
import { McpGroupsModule } from '../mcp-groups/mcp-groups.module';
import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';
import { DatabaseModule } from '../database/database.module';
import { McpDiscoveryOrchestratorService } from './mcp-discovery-orchestrator.service';
import { MCP_DISCOVERY_REDIS } from './mcp.tokens';
import type { RedisConfig } from '../config';

@Global()
@Module({
  imports: [
    SecretsModule,
    WorkflowsModule,
    ApiKeysModule,
    TemporalModule,
    DatabaseModule,
    McpGroupsModule,
  ],
  controllers: [McpGatewayController, InternalMcpController, McpDiscoveryController],
  providers: [
    {
      provide: MCP_DISCOVERY_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const redisUrl = redis.url || redis.terminalUrl || 'redis://localhost:6379';
        return new Redis(redisUrl);
      },
      inject: [ConfigService],
    },
    {
      provide: TOOL_REGISTRY_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const url = redis.toolRegistryUrl ?? redis.terminalUrl;
        if (!url) {
          new Logger('McpModule').warn('Redis URL not set; tool registry disabled');
        }
        if (!url) {
          return null;
        }
        return new Redis(url);
      },
      inject: [ConfigService],
    },
    ToolRegistryService,
    McpAuthService,
    McpGatewayService,
    McpDiscoveryOrchestratorService,
    McpServersRepository,
  ],
  exports: [ToolRegistryService, McpGatewayService, McpAuthService],
})
export class McpModule {}
