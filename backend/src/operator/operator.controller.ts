import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  OperatorActionDecisionSchema,
  OperatorCreateSessionSchema,
  OperatorCreateTurnSchema,
  OperatorUpdateSessionSchema,
  type OperatorActionView,
  type OperatorSessionDetail,
  type OperatorSessionSummary,
  type OperatorTurnAccepted,
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
  UpdateOperatorSessionDto,
} from './dto/operator.dto';
import { OperatorService } from './operator.service';

@ApiTags('operator')
@Controller('operator')
export class OperatorController {
  constructor(private readonly operatorService: OperatorService) {}

  @Get('sessions')
  @ApiOperation({ summary: 'List Operator sessions owned by the current user' })
  listSessions(@CurrentAuth() auth: AuthContext | null): Promise<OperatorSessionSummary[]> {
    return this.operatorService.listSessions(auth);
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Create an Operator session' })
  createSession(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(OperatorCreateSessionSchema)) body: CreateOperatorSessionDto,
  ): Promise<OperatorSessionSummary> {
    return this.operatorService.createSession(auth, body);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get one durable Operator session projection' })
  getSession(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorIdParamSchema)) params: OperatorIdParamDto,
  ): Promise<OperatorSessionDetail> {
    return this.operatorService.getSession(auth, params.id);
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
}
