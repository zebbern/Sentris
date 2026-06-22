import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ExecutionTriggerMetadata } from '@sentris/shared';
import type { Response } from 'express';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { timingSafeCompare } from '../common/crypto-utils';
import { ArtifactsService } from '../storage/artifacts.service';
import { RunArtifactIdParamDto, RunArtifactIdParamSchema } from '../storage/dto/artifacts.dto';
import { NodeIOService } from '../node-io/node-io.service';
import { PrepareRunRequestDto, PrepareRunRequestSchema } from './dto/workflow-graph.dto';
import { WorkflowRunService } from './workflow-run.service';

@ApiExcludeController()
@Controller('internal/runs')
export class InternalRunsController {
  private readonly internalServiceToken: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly workflowRunService: WorkflowRunService,
    private readonly nodeIOService: NodeIOService,
    private readonly artifactsService: ArtifactsService,
  ) {
    this.internalServiceToken = this.configService.get<string>('INTERNAL_SERVICE_TOKEN') || '';
  }

  @Post()
  async prepareRun(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(PrepareRunRequestSchema))
    body: PrepareRunRequestDto,
  ) {
    const triggerOverride = body.trigger as ExecutionTriggerMetadata | undefined;
    const triggerMetadata =
      triggerOverride ??
      ({
        type: 'api',
        sourceId: auth?.userId ?? null,
        label: 'Internal run request',
      } satisfies ExecutionTriggerMetadata);

    const prepared = await this.workflowRunService.prepareRunPayload(
      body.workflowId,
      {
        inputs: body.inputs,
        versionId: body.versionId,
        version: body.version,
      },
      auth,
      {
        trigger: triggerMetadata,
        nodeOverrides: body.nodeOverrides ?? undefined,
        runId: body.runId,
        idempotencyKey: body.idempotencyKey,
        parentRunId: body.parentRunId,
        parentNodeRef: body.parentNodeRef,
      },
    );

    return {
      runId: prepared.runId,
      workflowId: prepared.workflowId,
      workflowVersionId: prepared.workflowVersionId,
      workflowVersion: prepared.workflowVersion,
      organizationId: prepared.organizationId,
      definition: prepared.definition,
      inputs: prepared.inputs,
      trigger: prepared.triggerMetadata,
      inputPreview: prepared.inputPreview,
    };
  }

  @Get(':runId')
  async getRunMetadata(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('runId') runId: string,
  ) {
    const auth = this.assertInternalAccess(internalToken, organizationId);
    return this.workflowRunService.getRun(runId, auth);
  }

  @Get(':runId/node-io')
  async getNodeIO(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('runId') runId: string,
  ) {
    const auth = this.assertInternalAccess(internalToken, organizationId);
    await this.workflowRunService.getRun(runId, auth);
    const nodes = await this.nodeIOService.listDetails(runId, organizationId);
    return { runId, nodes };
  }

  @Get(':runId/artifacts')
  async listArtifacts(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('runId') runId: string,
  ) {
    const auth = this.assertInternalAccess(internalToken, organizationId);
    return this.artifactsService.listRunArtifacts(auth, runId);
  }

  @Get(':runId/artifacts/:artifactId/download')
  async downloadArtifact(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('runId') runId: string,
    @Param(new ZodValidationPipe(RunArtifactIdParamSchema)) params: RunArtifactIdParamDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const auth = this.assertInternalAccess(internalToken, organizationId);
    const { artifact, buffer, file } = await this.artifactsService.downloadArtifactForRun(
      auth,
      runId,
      params.artifactId,
    );

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.name}"`);
    res.setHeader('Content-Length', file.size.toString());

    return new StreamableFile(buffer);
  }

  private assertInternalAccess(
    internalToken: string | undefined,
    organizationId: string | undefined,
  ): AuthContext {
    if (!this.internalServiceToken) {
      throw new UnauthorizedException('INTERNAL_SERVICE_TOKEN is not configured');
    }

    if (!internalToken || !timingSafeCompare(internalToken, this.internalServiceToken)) {
      throw new UnauthorizedException('Invalid internal service token');
    }

    const normalizedOrgId = organizationId?.trim();
    if (!normalizedOrgId) {
      throw new UnauthorizedException('X-Organization-Id header is required');
    }

    return {
      userId: null,
      organizationId: normalizedOrgId,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'internal',
    };
  }
}
