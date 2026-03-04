import { Controller, Delete, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { InstanceHeartbeatService } from './instance-heartbeat.service';
import { SessionRegistryService } from '../../mcp/session-registry.service';

@ApiTags('admin')
@Controller('admin/instances')
export class AdminInstancesController {
  constructor(
    private readonly heartbeat: InstanceHeartbeatService,
    private readonly sessionRegistry: SessionRegistryService,
  ) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List alive backend instances (admin only)' })
  @ApiOkResponse({ description: 'Returns all alive backend instances with metadata' })
  async listInstances() {
    const [instances, { sessions }] = await Promise.all([
      this.heartbeat.listAliveInstances(),
      this.sessionRegistry.listActiveSessions(),
    ]);

    // Count sessions per instance
    const sessionCountByInstance = new Map<string, number>();
    for (const session of sessions) {
      const count = sessionCountByInstance.get(session.instanceId) ?? 0;
      sessionCountByInstance.set(session.instanceId, count + 1);
    }

    const enriched = instances.map((instance) => ({
      ...instance,
      uptimeSeconds: Math.floor((Date.now() - new Date(instance.startedAt).getTime()) / 1000),
      sessionCount: sessionCountByInstance.get(instance.instanceId) ?? 0,
    }));

    return {
      count: enriched.length,
      instances: enriched,
    };
  }

  @Get('stale-sessions')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Detect sessions owned by dead instances (admin only)' })
  @ApiOkResponse({ description: 'Returns sessions whose owning instance is no longer alive' })
  async detectStaleSessions() {
    const staleSessions = await this.sessionRegistry.detectStaleSessions();
    return {
      count: staleSessions.length,
      sessions: staleSessions,
    };
  }

  @Delete('stale-sessions')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Clean up stale sessions owned by dead instances (admin only)' })
  @ApiOkResponse({
    description: 'Removes stale session registry entries and returns removed count',
  })
  async cleanupStaleSessions() {
    return this.sessionRegistry.cleanupStaleSessions();
  }
}
