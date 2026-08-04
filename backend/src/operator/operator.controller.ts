import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  OperatorActionDecisionSchema,
  OperatorCreateSessionSchema,
  OperatorCreateTurnSchema,
  OperatorUpdateSessionSchema,
  type OperatorActionView,
  type OperatorRunImprovementLookup,
  type OperatorSessionDetail,
  type OperatorSessionSummary,
  type OperatorTurnAccepted,
  type OperatorTurnView,
} from '@sentris/shared';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import {
  CreateOperatorSessionDto,
  CreateOperatorTurnDto,
  OperatorActionDecisionDto,
  OperatorActionIdParamDto,
  OperatorActionIdParamSchema,
  OperatorIdParamDto,
  OperatorIdParamSchema,
  OperatorRunIdParamDto,
  OperatorRunIdParamSchema,
  OperatorRunImprovementLookupDto,
  OperatorTurnIdParamDto,
  OperatorTurnIdParamSchema,
  OperatorWorkflowDraftDetailDto,
  UpdateOperatorSessionDto,
} from './dto/operator.dto';
import { OperatorSessionStreamService } from './operator-session-stream.service';
import { OperatorService } from './operator.service';

@ApiTags('operator')
@Controller('operator')
export class OperatorController {
  constructor(
    private readonly operatorService: OperatorService,
    private readonly operatorSessionStreamService: OperatorSessionStreamService,
  ) {}

  @Get('sessions')
  @ApiOperation({ summary: 'List Operator sessions owned by the current user' })
  listSessions(@CurrentAuth() auth: AuthContext | null): Promise<OperatorSessionSummary[]> {
    return this.operatorService.listSessions(auth);
  }

  @Get('run-improvements/:runId')
  @ApiOperation({ summary: 'Locate the latest Operator improvement for one source run' })
  @ApiOkResponse({ type: OperatorRunImprovementLookupDto })
  getRunImprovement(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorRunIdParamSchema)) params: OperatorRunIdParamDto,
  ): Promise<OperatorRunImprovementLookup> {
    return this.operatorService.getRunImprovement(auth, params.runId);
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Create an Operator session' })
  createSession(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(OperatorCreateSessionSchema)) body: CreateOperatorSessionDto,
  ): Promise<OperatorSessionSummary> {
    return this.operatorService.createSession(auth, body);
  }

  @Get('sessions/:id/stream')
  @ApiOperation({ summary: 'Stream one durable Operator session projection via SSE' })
  @ApiOkResponse({ description: 'Server-sent Operator session snapshots' })
  streamSession(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorIdParamSchema)) params: OperatorIdParamDto,
    @Res() response: Response,
  ): Promise<void> {
    return this.operatorSessionStreamService.streamSession(auth, params.id, response);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get one durable Operator session projection' })
  getSession(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorIdParamSchema)) params: OperatorIdParamDto,
  ): Promise<OperatorSessionDetail> {
    return this.operatorService.getSession(auth, params.id);
  }

  @Get('sessions/:id/workflow-drafts')
  @ApiOperation({ summary: 'List durable workflow drafts for one Operator session' })
  @ApiOkResponse({ type: [OperatorWorkflowDraftDetailDto] })
  listWorkflowDrafts(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorIdParamSchema)) params: OperatorIdParamDto,
  ): Promise<OperatorWorkflowDraftDetailDto[]> {
    return this.operatorService.listWorkflowDrafts(auth, params.id);
  }

  @Patch('sessions/:id')
  @ApiOperation({ summary: 'Update an Operator session mode or model' })
  updateSession(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorIdParamSchema)) params: OperatorIdParamDto,
    @Body(new ZodValidationPipe(OperatorUpdateSessionSchema)) body: UpdateOperatorSessionDto,
  ): Promise<OperatorSessionSummary> {
    return this.operatorService.updateSession(auth, params.id, body);
  }

  @Post('sessions/:id/turns')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit a durable Operator turn' })
  createTurn(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorIdParamSchema)) params: OperatorIdParamDto,
    @Body(new ZodValidationPipe(OperatorCreateTurnSchema)) body: CreateOperatorTurnDto,
  ): Promise<OperatorTurnAccepted> {
    return this.operatorService.createTurn(auth, params.id, body);
  }

  @Post('actions/:actionId/decision')
  @ApiOperation({ summary: 'Approve or reject a pending Operator action' })
  decideAction(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorActionIdParamSchema)) params: OperatorActionIdParamDto,
    @Body(new ZodValidationPipe(OperatorActionDecisionSchema)) body: OperatorActionDecisionDto,
  ): Promise<OperatorActionView> {
    return this.operatorService.decideAction(auth, params.actionId, body);
  }

  @Post('turns/:turnId/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request cancellation of an active Operator turn' })
  cancelTurn(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorTurnIdParamSchema)) params: OperatorTurnIdParamDto,
  ): Promise<OperatorTurnView> {
    return this.operatorService.cancelTurn(auth, params.turnId);
  }
}
