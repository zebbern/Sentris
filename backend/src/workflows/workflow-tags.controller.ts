import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AllTagsResponseDto } from './dto/workflow-tags.dto';
import { WorkflowTagsService } from './workflow-tags.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('workflow-tags')
@Controller('workflow-tags')
export class WorkflowTagsController {
  constructor(private readonly workflowTagsService: WorkflowTagsService) {}

  @Get()
  @ApiOperation({ summary: 'List all unique tags with usage counts' })
  @ApiOkResponse({
    type: AllTagsResponseDto,
    description: 'All tags across workflows, sorted alphabetically',
  })
  async listAllTags(@CurrentAuth() auth: AuthContext | null): Promise<AllTagsResponseDto> {
    return this.workflowTagsService.listAllTags(auth);
  }
}
