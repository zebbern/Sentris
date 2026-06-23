import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { AgentSkillsService } from './agent-skills.service';
import type { AgentSkillBatchItem } from './dto/agent-skills.dto';

@ApiExcludeController()
@Controller('internal/agent-skills')
export class InternalAgentSkillsController {
  constructor(private readonly agentSkillsService: AgentSkillsService) {}

  @Get('batch')
  async batchGetSkills(
    @CurrentAuth() auth: AuthContext | null,
    @Query('ids') idsParam?: string,
  ): Promise<AgentSkillBatchItem[]> {
    const organizationId = requireOrganizationId(auth);
    if (!idsParam?.trim()) {
      throw new BadRequestException('ids query parameter is required');
    }
    const ids = idsParam
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return this.agentSkillsService.batchGetSkills(organizationId, ids);
  }
}
