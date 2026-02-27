import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { DatabaseModule } from '../database/database.module';
import { McpGroupsController } from './mcp-groups.controller';
import { McpGroupsRepository } from './mcp-groups.repository';
import { McpGroupsService } from './mcp-groups.service';
import { McpGroupsSeedingService } from './mcp-groups-seeding.service';
import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';
import type { RedisConfig } from '../config';

// Redis injection token - must match the one in mcp-servers.service.ts
const MCP_SERVERS_REDIS = 'MCP_SERVERS_REDIS';

@Module({
  imports: [DatabaseModule],
  controllers: [McpGroupsController],
  providers: [
    McpGroupsService,
    McpGroupsRepository,
    McpGroupsSeedingService,
    McpServersRepository,
    {
      provide: MCP_SERVERS_REDIS,
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis')!;
        const url = redis.url ?? redis.terminalUrl ?? 'redis://localhost:6379';
        return new Redis(url);
      },
      inject: [ConfigService],
    },
  ],
  exports: [McpGroupsService, McpGroupsRepository],
})
export class McpGroupsModule {}
