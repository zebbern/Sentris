import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import {
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ZodValidationPipe } from 'nestjs-zod';

import { Roles } from '../auth/roles.decorator';

import { CurrentAuth } from '../auth/auth-context.decorator';

import type { AuthContext } from '../auth/types';

import { AgentSkillsService } from './agent-skills.service';

import {
  AgentSkillResponse,
  CreateAgentSkillDto,
  CreateAgentSkillSchema,
  DiscoveredAgentSkillResponse,
  ImportAgentSkillsResultResponse,
  ImportDiscoveredAgentSkillsDto,
  ImportDiscoveredAgentSkillsSchema,
  UpdateAgentSkillDto,
  UpdateAgentSkillSchema,
} from './dto/agent-skills.dto';

interface MulterFile {
  buffer: Buffer;

  mimetype: string;

  originalname: string;

  size: number;
}

@ApiTags('agent-skills')
@Controller('agent-skills')
export class AgentSkillsController {
  constructor(private readonly agentSkillsService: AgentSkillsService) {}

  @Get()
  @ApiOperation({ summary: 'List agent skills for the current organization' })
  @ApiOkResponse({ type: [AgentSkillResponse] })
  async listSkills(
    @CurrentAuth() auth: AuthContext | null,

    @Query('enabledOnly') enabledOnly?: string,
  ): Promise<AgentSkillResponse[]> {
    return this.agentSkillsService.listSkills(auth, enabledOnly === 'true');
  }

  @Get('discover')
  @ApiOperation({
    summary:
      'Discover skill folders under .agents/skills, .claude/skills, .github/skills, .codex/skills, .kimi/skills, and .opencode/skills',
  })
  @ApiOkResponse({ type: [DiscoveredAgentSkillResponse] })
  async discoverSkills(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<DiscoveredAgentSkillResponse[]> {
    return this.agentSkillsService.discoverSkills(auth);
  }

  @Post('import-discovered')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Import discovered workspace skill folders into the org library' })
  @ApiCreatedResponse({ type: ImportAgentSkillsResultResponse })
  async importDiscoveredSkills(
    @CurrentAuth() auth: AuthContext | null,

    @Body(new ZodValidationPipe(ImportDiscoveredAgentSkillsSchema))
    body: ImportDiscoveredAgentSkillsDto,
  ): Promise<ImportAgentSkillsResultResponse> {
    return this.agentSkillsService.importDiscoveredSkills(auth, body);
  }

  @Post('import-zip')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Import one or more skill folders from a zip archive' })
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ type: ImportAgentSkillsResultResponse })
  @UseInterceptors(FileInterceptor('file'))
  async importSkillZip(
    @CurrentAuth() auth: AuthContext | null,

    @UploadedFile() file: MulterFile | undefined,

    @Query('overwrite') overwrite?: string,
  ): Promise<ImportAgentSkillsResultResponse> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Zip file is required');
    }

    return this.agentSkillsService.importSkillZip(auth, file.buffer, overwrite === 'true');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an agent skill by id' })
  @ApiOkResponse({ type: AgentSkillResponse })
  async getSkill(
    @CurrentAuth() auth: AuthContext | null,

    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AgentSkillResponse> {
    return this.agentSkillsService.getSkill(auth, id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create an agent skill' })
  @ApiCreatedResponse({ type: AgentSkillResponse })
  async createSkill(
    @CurrentAuth() auth: AuthContext | null,

    @Body(new ZodValidationPipe(CreateAgentSkillSchema)) body: CreateAgentSkillDto,
  ): Promise<AgentSkillResponse> {
    return this.agentSkillsService.createSkill(auth, body);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update an agent skill' })
  @ApiOkResponse({ type: AgentSkillResponse })
  async updateSkill(
    @CurrentAuth() auth: AuthContext | null,

    @Param('id', new ParseUUIDPipe()) id: string,

    @Body(new ZodValidationPipe(UpdateAgentSkillSchema)) body: UpdateAgentSkillDto,
  ): Promise<AgentSkillResponse> {
    return this.agentSkillsService.updateSkill(auth, id, body);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent skill' })
  @ApiNoContentResponse()
  async deleteSkill(
    @CurrentAuth() auth: AuthContext | null,

    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.agentSkillsService.deleteSkill(auth, id);
  }
}
