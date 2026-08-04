import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiAcceptedResponse, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { AgentTraceService } from '../agent-trace/agent-trace.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { AgentFollowUpService } from './agent-follow-up.service';
import {
  AgentFollowUpRequestDto,
  AgentFollowUpRequestSchema,
} from './dto/agent-follow-up-request.dto';

@ApiTags('agents')
@Controller('agents')
export class AgentFollowUpsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly agentTraceService: AgentTraceService,
    private readonly followUps: AgentFollowUpService,
  ) {}

  @Post('/:agentRunId/follow-ups')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start a durable follow-up turn for a completed workflow Agent' })
  @ApiBody({ type: AgentFollowUpRequestDto })
  @ApiAcceptedResponse({ description: 'The follow-up turn was accepted' })
  async followUp(
    @Param('agentRunId') agentRunId: string,
    @Body(new ZodValidationPipe(AgentFollowUpRequestSchema)) body: AgentFollowUpRequestDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    const conversation = await this.agentTraceService.getConversation(agentRunId);
    if (!conversation) {
      throw new NotFoundException(`Agent run ${agentRunId} not found`);
    }
    await this.workflowsService.ensureRunAccess(conversation.workflowRunId, auth);
    return this.followUps.start({
      agentRunId: conversation.conversationId,
      requestId: body.requestId,
      message: body.message,
      organizationId: auth?.organizationId ?? null,
    });
  }
}
