import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import type {
  OperatorActionView,
  McpOperationInvocationRequest,
  OperatorModelContext,
  OperatorPlanProposalResult,
  OperatorPreparedAction,
  OperatorRunObservation,
  OperatorTurnView,
} from '@sentris/shared';

import { CurrentAuth } from '../auth/auth-context.decorator';
import { InternalOnlyGuard } from '../auth/internal-only.guard';
import type { AuthContext } from '../auth/types';
import {
  InternalCompleteOperatorTurnDto,
  InternalCompleteOperatorTurnSchema,
  InternalCancelOperatorTurnDto,
  InternalCancelOperatorTurnSchema,
  InternalFailOperatorTurnDto,
  InternalFailOperatorTurnSchema,
  InternalOperatorObservationQueryDto,
  InternalOperatorObservationQuerySchema,
  InternalOperatorOrganizationDto,
  InternalOperatorOrganizationSchema,
  InternalOperatorRunFollowUpDto,
  InternalOperatorRunFollowUpSchema,
  InternalOperatorPlanParamDto,
  InternalOperatorPlanParamSchema,
  InternalOperatorStatusDto,
  InternalOperatorStatusSchema,
  InternalSettleOperatorMcpActionDto,
  InternalSettleOperatorMcpActionSchema,
  InternalPrepareOperatorActionDto,
  InternalPrepareOperatorActionSchema,
  OperatorActionIdParamDto,
  OperatorActionIdParamSchema,
  OperatorRunIdParamDto,
  OperatorRunIdParamSchema,
  OperatorTurnIdParamDto,
  OperatorTurnIdParamSchema,
} from './dto/operator.dto';
import { OperatorService } from './operator.service';

@ApiExcludeController()
@Controller('operator/internal')
@UseGuards(InternalOnlyGuard)
export class InternalOperatorController {
  constructor(private readonly operatorService: OperatorService) {}

  @Post('run-follow-ups')
  @ApiOperation({ summary: 'Create one durable follow-up turn for an Operator-launched run' })
  createRunFollowUp(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(InternalOperatorRunFollowUpSchema))
    body: InternalOperatorRunFollowUpDto,
  ): Promise<{ disposition: 'started' | 'ignored'; turnId?: string }> {
    const organizationId = this.requireInternalOrg(auth, body.organizationId);
    return this.operatorService.createInternalRunFollowUp({ ...body, organizationId });
  }

  @Get('turns/:turnId/context')
  @ApiOperation({ summary: 'Load bounded Operator model context for a worker activity' })
  getContext(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorTurnIdParamSchema)) params: OperatorTurnIdParamDto,
  ): Promise<OperatorModelContext> {
    return this.operatorService.getInternalContext(params.turnId, this.requireInternalOrg(auth));
  }

  @Get('turns/:turnId/plans/:planActionId')
  @ApiOperation({ summary: 'Load one immutable Operator plan for its execution journey' })
  getPlan(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(InternalOperatorPlanParamSchema))
    params: InternalOperatorPlanParamDto,
  ): Promise<OperatorPlanProposalResult> {
    return this.operatorService.getInternalPlan(
      params.turnId,
      params.planActionId,
      this.requireInternalOrg(auth),
    );
  }

  @Post('turns/:turnId/status')
  setTurnStatus(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorTurnIdParamSchema)) params: OperatorTurnIdParamDto,
    @Body(new ZodValidationPipe(InternalOperatorStatusSchema)) body: InternalOperatorStatusDto,
  ): Promise<OperatorTurnView> {
    const organizationId = this.requireInternalOrg(auth, body.organizationId);
    return this.operatorService.setInternalTurnStatus(params.turnId, organizationId, body.status);
  }

  @Post('turns/:turnId/actions/prepare')
  prepareAction(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorTurnIdParamSchema)) params: OperatorTurnIdParamDto,
    @Body(new ZodValidationPipe(InternalPrepareOperatorActionSchema))
    body: InternalPrepareOperatorActionDto,
  ): Promise<OperatorPreparedAction> {
    const organizationId = this.requireInternalOrg(auth, body.organizationId);
    return this.operatorService.prepareInternalAction({
      turnId: params.turnId,
      organizationId,
      toolCallId: body.toolCallId,
      commandName: body.commandName,
      arguments: body.arguments,
      userConfirmed: body.userConfirmed,
    });
  }

  @Post('actions/:actionId/execute')
  executeAction(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorActionIdParamSchema)) params: OperatorActionIdParamDto,
    @Body(new ZodValidationPipe(InternalOperatorOrganizationSchema))
    body: InternalOperatorOrganizationDto,
  ): Promise<{
    action: OperatorActionView;
    result: unknown;
    launchedRunId?: string;
    mcpOperationRequest?: McpOperationInvocationRequest;
  }> {
    const organizationId = this.requireInternalOrg(auth, body.organizationId);
    return this.operatorService.executeInternalAction(params.actionId, organizationId);
  }

  @Post('actions/:actionId/mcp/settle')
  settleMcpAction(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorActionIdParamSchema)) params: OperatorActionIdParamDto,
    @Body(new ZodValidationPipe(InternalSettleOperatorMcpActionSchema))
    body: InternalSettleOperatorMcpActionDto,
  ): Promise<OperatorActionView> {
    const organizationId = this.requireInternalOrg(auth, body.organizationId);
    return this.operatorService.settleInternalMcpAction({
      actionId: params.actionId,
      organizationId,
      result: body.result,
    });
  }

  @Get('runs/:runId/observation')
  observeRun(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorRunIdParamSchema)) params: OperatorRunIdParamDto,
    @Query(new ZodValidationPipe(InternalOperatorObservationQuerySchema))
    query: InternalOperatorObservationQueryDto,
  ): Promise<OperatorRunObservation> {
    return this.operatorService.observeInternalRun({
      runId: params.runId,
      turnId: query.turnId,
      organizationId: this.requireInternalOrg(auth),
    });
  }

  @Post('turns/:turnId/complete')
  async completeTurn(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorTurnIdParamSchema)) params: OperatorTurnIdParamDto,
    @Body(new ZodValidationPipe(InternalCompleteOperatorTurnSchema))
    body: InternalCompleteOperatorTurnDto,
  ): Promise<{ completed: true }> {
    const organizationId = this.requireInternalOrg(auth, body.organizationId);
    await this.operatorService.completeInternalTurn({
      turnId: params.turnId,
      organizationId,
      message: body.message,
    });
    return { completed: true };
  }

  @Post('turns/:turnId/fail')
  async failTurn(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorTurnIdParamSchema)) params: OperatorTurnIdParamDto,
    @Body(new ZodValidationPipe(InternalFailOperatorTurnSchema)) body: InternalFailOperatorTurnDto,
  ): Promise<{ failed: true }> {
    const organizationId = this.requireInternalOrg(auth, body.organizationId);
    await this.operatorService.failInternalTurn({
      turnId: params.turnId,
      organizationId,
      error: body.error,
    });
    return { failed: true };
  }

  @Post('turns/:turnId/cancel')
  async cancelTurn(
    @CurrentAuth() auth: AuthContext | null,
    @Param(new ZodValidationPipe(OperatorTurnIdParamSchema)) params: OperatorTurnIdParamDto,
    @Body(new ZodValidationPipe(InternalCancelOperatorTurnSchema))
    body: InternalCancelOperatorTurnDto,
  ): Promise<{ cancelled: true }> {
    const organizationId = this.requireInternalOrg(auth, body.organizationId);
    await this.operatorService.cancelInternalTurn({
      turnId: params.turnId,
      organizationId,
      message: body.message,
    });
    return { cancelled: true };
  }

  private requireInternalOrg(auth: AuthContext | null, requested?: string): string {
    const organizationId = auth?.organizationId;
    if (!organizationId || (requested !== undefined && requested !== organizationId)) {
      throw new ForbiddenException('Internal organization scope mismatch');
    }
    return organizationId;
  }
}
