import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { WorkflowLogsQueryDto, WorkflowLogsQuerySchema } from './dto/workflow-graph.dto';
import { TraceService } from '../trace/trace.service';
import { WorkflowsService } from './workflows.service';
import { ArtifactsService } from '../storage/artifacts.service';
import { LogStreamService } from '../trace/log-stream.service';
import { NodeIOService } from '../node-io/node-io.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { RunArtifactsResponseDto } from '../storage/dto/artifact.dto';
import { RunArtifactIdParamDto, RunArtifactIdParamSchema } from '../storage/dto/artifacts.dto';
import type { Response } from 'express';

const traceFailureSchema = {
  type: 'object',
  properties: {
    at: { type: 'string', format: 'date-time' },
    reason: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        name: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const traceRetryPolicySchema = {
  type: 'object',
  properties: {
    maxAttempts: { type: 'integer', minimum: 1 },
    initialIntervalSeconds: { type: 'number', minimum: 0 },
    maximumIntervalSeconds: { type: 'number', minimum: 0 },
    backoffCoefficient: { type: 'number', minimum: 0 },
    nonRetryableErrorTypes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  additionalProperties: false,
};

const traceMetadataSchema = {
  type: 'object',
  properties: {
    activityId: { type: 'string' },
    attempt: { type: 'integer', minimum: 0 },
    correlationId: { type: 'string' },
    streamId: { type: 'string' },
    joinStrategy: {
      type: 'string',
      enum: ['all', 'any', 'first'],
    },
    triggeredBy: { type: 'string' },
    failure: { ...traceFailureSchema, nullable: true },
    retryPolicy: { ...traceRetryPolicySchema, nullable: true },
  },
  additionalProperties: false,
};

const traceErrorSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    stack: { type: 'string' },
    code: { type: 'string' },
    type: { type: 'string' },
    details: {
      type: 'object',
      additionalProperties: true,
    },
    fieldErrors: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  },
  additionalProperties: false,
};

const traceEventSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    runId: { type: 'string' },
    nodeId: { type: 'string' },
    type: {
      type: 'string',
      enum: ['STARTED', 'PROGRESS', 'COMPLETED', 'FAILED'],
    },
    level: {
      type: 'string',
      enum: ['info', 'warn', 'error', 'debug'],
    },
    timestamp: { type: 'string', format: 'date-time' },
    message: { type: 'string', nullable: true },
    error: { ...traceErrorSchema, nullable: true },
    outputSummary: {
      type: 'object',
      additionalProperties: true,
      nullable: true,
    },
    data: {
      type: 'object',
      additionalProperties: true,
      nullable: true,
    },
    metadata: { ...traceMetadataSchema, nullable: true },
  },
  additionalProperties: false,
};

const traceEnvelopeSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    events: {
      type: 'array',
      items: traceEventSchema,
    },
    cursor: { type: 'string', nullable: true },
  },
  additionalProperties: false,
};

const dataFlowPacketSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    runId: { type: 'string' },
    sourceNode: { type: 'string' },
    targetNode: { type: 'string' },
    inputKey: { type: 'string', nullable: true },
    payload: {
      type: 'object',
      additionalProperties: true,
      nullable: true,
    },
    timestamp: { type: 'integer' },
    visualTime: { type: 'number' },
    size: { type: 'number' },
    type: {
      type: 'string',
      enum: ['file', 'json', 'text', 'binary'],
    },
  },
  additionalProperties: false,
};

const dataFlowEnvelopeSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    packets: {
      type: 'array',
      items: dataFlowPacketSchema,
    },
  },
  additionalProperties: false,
};

@ApiTags('workflows')
@Controller('workflows')
export class WorkflowRunObservabilityController {
  constructor(
    private readonly traceService: TraceService,
    private readonly workflowsService: WorkflowsService,
    private readonly artifactsService: ArtifactsService,
    private readonly nodeIOService: NodeIOService,
    private readonly logStreamService: LogStreamService,
  ) {}

  @Get('/runs/:runId/trace')
  @ApiOperation({ summary: 'Get workflow run trace events' })
  @ApiOkResponse({
    description: 'Trace events for a workflow run',
    schema: traceEnvelopeSchema,
  })
  async trace(@Param('runId') runId: string, @CurrentAuth() auth: AuthContext | null) {
    const { events, cursor } = await this.traceService.list(runId, auth);
    return { runId, events, cursor };
  }

  @Get('/runs/:runId/events')
  @ApiOperation({ summary: 'Get workflow run event timeline' })
  @ApiOkResponse({
    description: 'Full event timeline for a workflow run',
    schema: traceEnvelopeSchema,
  })
  async events(@Param('runId') runId: string, @CurrentAuth() auth: AuthContext | null) {
    const { events, cursor } = await this.traceService.list(runId, auth);
    return { runId, events, cursor };
  }

  @Get('/runs/:runId/dataflows')
  @ApiOperation({ summary: 'Get workflow run data flows' })
  @ApiOkResponse({
    description: 'Derived data flow packets for a workflow run',
    schema: dataFlowEnvelopeSchema,
  })
  async dataflows(@Param('runId') runId: string, @CurrentAuth() auth: AuthContext | null) {
    const { events } = await this.traceService.list(runId, auth);
    const packets = await this.workflowsService.buildDataFlows(runId, events);
    return { runId, packets };
  }

  @Get('/runs/:runId/artifacts')
  @ApiOperation({ summary: 'List workflow run artifacts' })
  @ApiOkResponse({
    description: 'Artifacts generated for a workflow run',
    type: RunArtifactsResponseDto,
  })
  async runArtifacts(@Param('runId') runId: string, @CurrentAuth() auth: AuthContext | null) {
    return this.artifactsService.listRunArtifacts(auth, runId);
  }

  @Get('/runs/:runId/artifacts/:artifactId/download')
  @ApiOperation({ summary: 'Download a workflow run artifact' })
  @ApiOkResponse({
    description: 'Download artifact for a specific run',
  })
  async downloadRunArtifact(
    @Param('runId') runId: string,
    @Param(new ZodValidationPipe(RunArtifactIdParamSchema)) params: RunArtifactIdParamDto,
    @CurrentAuth() auth: AuthContext | null,
    @Res({ passthrough: true }) res: Response,
  ) {
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

  @Get('/runs/:runId/node-io')
  @ApiOperation({ summary: 'List node inputs and outputs for a workflow run' })
  @ApiOkResponse({
    description: 'Node inputs/outputs for a workflow run',
    schema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeRef: { type: 'string' },
              componentId: { type: 'string' },
              status: { type: 'string', enum: ['running', 'completed', 'failed', 'skipped'] },
              startedAt: { type: 'string', format: 'date-time', nullable: true },
              completedAt: { type: 'string', format: 'date-time', nullable: true },
              durationMs: { type: 'number', nullable: true },
              inputs: { type: 'object', additionalProperties: true, nullable: true },
              outputs: { type: 'object', additionalProperties: true, nullable: true },
              inputsSize: { type: 'number' },
              outputsSize: { type: 'number' },
              inputsSpilled: { type: 'boolean' },
              outputsSpilled: { type: 'boolean' },
              errorMessage: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  })
  async getNodeIO(@Param('runId') runId: string, @CurrentAuth() auth: AuthContext | null) {
    await this.workflowsService.ensureRunAccess(runId, auth);
    const nodes = await this.nodeIOService.listDetails(runId, auth?.organizationId);
    return { runId, nodes };
  }

  @Get('/runs/:runId/node-io/:nodeRef')
  @ApiOperation({ summary: 'Get specific node input/output for a workflow run' })
  @ApiQuery({
    name: 'full',
    required: false,
    type: Boolean,
    description: 'Request full node I/O data instead of a preview',
  })
  @ApiOkResponse({
    description: 'Specific node input/output for a workflow run',
    schema: {
      type: 'object',
      properties: {
        nodeRef: { type: 'string' },
        componentId: { type: 'string' },
        status: { type: 'string', enum: ['running', 'completed', 'failed', 'skipped'] },
        startedAt: { type: 'string', format: 'date-time', nullable: true },
        completedAt: { type: 'string', format: 'date-time', nullable: true },
        durationMs: { type: 'number', nullable: true },
        inputs: { type: 'object', additionalProperties: true, nullable: true },
        outputs: { type: 'object', additionalProperties: true, nullable: true },
        inputsSize: { type: 'number' },
        outputsSize: { type: 'number' },
        inputsSpilled: { type: 'boolean' },
        outputsSpilled: { type: 'boolean' },
        inputsTruncated: { type: 'boolean' },
        outputsTruncated: { type: 'boolean' },
        errorMessage: { type: 'string', nullable: true },
      },
    },
  })
  async getNodeIODetail(
    @Param('runId') runId: string,
    @Param('nodeRef') nodeRef: string,
    @Query('full') full: string | undefined,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    await this.workflowsService.ensureRunAccess(runId, auth);
    const isFull = full === 'true' || full === '1';
    const nodeIO = await this.nodeIOService.getNodeIO(runId, nodeRef, isFull);
    if (!nodeIO) {
      throw new BadRequestException(`Node I/O not found for node ${nodeRef} in run ${runId}`);
    }
    return nodeIO;
  }

  @Get('/runs/:runId/logs')
  @ApiOperation({ summary: 'Get workflow run logs' })
  @ApiOkResponse({
    description: 'Logs for a workflow run',
    schema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        logs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              runId: { type: 'string' },
              nodeId: { type: 'string' },
              level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
              message: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
        totalCount: { type: 'number' },
        hasMore: { type: 'boolean' },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  })
  async logs(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(WorkflowLogsQuerySchema))
    query: WorkflowLogsQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.logStreamService.fetch(runId, auth, {
      nodeRef: query.nodeRef,
      stream: query.stream,
      level: query.level,
      limit: query.limit,
      cursor: query.cursor,
      startTime: query.startTime,
      endTime: query.endTime,
    });
  }
}
