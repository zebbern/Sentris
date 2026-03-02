import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AllTagsResponseDto } from './dto/workflow-tags.dto';
import { WorkflowsService } from './workflows.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('workflow-tags')
@Controller('workflow-tags')
export class WorkflowTagsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Get()
  @ApiOperation({ summary: 'List all unique tags with usage counts' })
  @ApiOkResponse({
    type: AllTagsResponseDto,
    description: 'All tags across workflows, sorted alphabetically',
  })
  async listAllTags(@CurrentAuth() auth: AuthContext | null): Promise<AllTagsResponseDto> {
    return this.workflowsService.listAllTags(auth);
  }
}
