import { Controller, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  ListRunsQueryDto,
  ListRunsQuerySchema,
  TemporalRunQueryDto,
  TemporalRunQuerySchema,
} from './dto/workflow-graph.dto';
import { WorkflowRunService } from './workflow-run.service';
import { TerminalArchiveService } from './terminal-archive.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { TERMINAL_STATUSES } from '@sentris/shared';

const TERMINAL_COMPLETION_STATUSES = new Set(TERMINAL_STATUSES);

const runConfigSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    workflowId: { type: 'string' },
    workflowVersionId: { type: 'string', nullable: true },
    workflowVersion: { type: 'integer', nullable: true },
    inputs: {
      type: 'object',
      additionalProperties: true,
    },
  },
  additionalProperties: false,
};

@ApiTags('workflows')
@Controller('workflows')
export class WorkflowRunsController {
  private readonly logger = new Logger(WorkflowRunsController.name);

  constructor(
    private readonly workflowRunService: WorkflowRunService,
    private readonly terminalArchiveService: TerminalArchiveService,
  ) {}

  @Get('/runs')
  @ApiOperation({ summary: 'List workflow runs' })
  @ApiOkResponse({
    description: 'List all workflow runs with metadata',
    schema: {
      type: 'object',
      properties: {
        runs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              workflowId: { type: 'string' },
              organizationId: { type: 'string' },
              status: {
                type: 'string',
                enum: [
                  'RUNNING',
                  'COMPLETED',
                  'FAILED',
                  'CANCELLED',
                  'TERMINATED',
                  'CONTINUED_AS_NEW',
                  'TIMED_OUT',
                  'UNKNOWN',
                ],
              },
              startTime: { type: 'string', format: 'date-time' },
              endTime: { type: 'string', format: 'date-time', nullable: true },
              temporalRunId: { type: 'string' },
              workflowVersionId: { type: 'string', nullable: true },
              workflowVersion: { type: 'number', nullable: true },
              workflowName: { type: 'string' },
              eventCount: { type: 'number' },
              nodeCount: { type: 'number' },
              duration: { type: 'number' },
              triggerType: {
                type: 'string',
                enum: ['manual', 'schedule', 'api'],
              },
              triggerSource: { type: 'string', nullable: true },
              triggerLabel: { type: 'string', nullable: true },
              inputPreview: {
                type: 'object',
                properties: {
                  runtimeInputs: {
                    type: 'object',
                    additionalProperties: true,
                  },
                  nodeOverrides: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      additionalProperties: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  async listRuns(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(ListRunsQuerySchema)) query: ListRunsQueryDto,
  ) {
    return this.workflowRunService.listRuns(auth, {
      workflowId: query.workflowId,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('/runs/:runId')
  @ApiOperation({ summary: 'Get a workflow run' })
  @ApiOkResponse({
    description: 'Metadata for a single workflow run',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        workflowId: { type: 'string' },
        organizationId: { type: 'string' },
        status: {
          type: 'string',
          enum: [
            'RUNNING',
            'COMPLETED',
            'FAILED',
            'CANCELLED',
            'TERMINATED',
            'CONTINUED_AS_NEW',
            'TIMED_OUT',
            'UNKNOWN',
          ],
        },
        startTime: { type: 'string', format: 'date-time' },
        endTime: { type: 'string', format: 'date-time', nullable: true },
        temporalRunId: { type: 'string', nullable: true },
        workflowVersionId: { type: 'string', nullable: true },
        workflowVersion: { type: 'number', nullable: true },
        workflowName: { type: 'string' },
        eventCount: { type: 'number' },
        nodeCount: { type: 'number' },
        duration: { type: 'number' },
        triggerType: {
          type: 'string',
          enum: ['manual', 'schedule', 'api'],
        },
        triggerSource: { type: 'string', nullable: true },
        triggerLabel: { type: 'string', nullable: true },
        inputPreview: {
          type: 'object',
          properties: {
            runtimeInputs: {
              type: 'object',
              additionalProperties: true,
            },
            nodeOverrides: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
  })
  async getRun(@CurrentAuth() auth: AuthContext | null, @Param('runId') runId: string) {
    return this.workflowRunService.getRun(runId, auth);
  }

  @Get('/runs/:runId/children')
  @ApiOperation({ summary: 'List child workflow runs' })
  @ApiOkResponse({
    description: 'List direct child workflow runs spawned by a parent run',
    schema: {
      type: 'object',
      properties: {
        runs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              runId: { type: 'string' },
              workflowId: { type: 'string' },
              workflowName: { type: 'string' },
              parentNodeRef: { type: 'string', nullable: true },
              status: { type: 'string' },
              startedAt: { type: 'string', format: 'date-time' },
              completedAt: { type: 'string', format: 'date-time', nullable: true },
            },
          },
        },
      },
    },
  })
  async listChildRuns(@CurrentAuth() auth: AuthContext | null, @Param('runId') runId: string) {
    return this.workflowRunService.listChildRuns(runId, auth);
  }

  @Get('/runs/:runId/status')
  @ApiOperation({ summary: 'Get workflow run status' })
  @ApiOkResponse({
    description: 'Current Temporal execution status',
  })
  async status(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TemporalRunQuerySchema)) query: TemporalRunQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    const result = await this.workflowRunService.getRunStatus(runId, query.temporalRunId, auth);
    if (TERMINAL_COMPLETION_STATUSES.has(result.status)) {
      this.terminalArchiveService.archiveRun(auth, runId).catch((error) => {
        this.logger.warn(`Failed to archive terminal after status fetch for run ${runId}`, error);
      });
    }
    return result;
  }

  @Get('/runs/:runId/result')
  @ApiOperation({ summary: 'Get workflow run result' })
  @ApiOkResponse({
    description: 'Resolved workflow result payload',
  })
  async result(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TemporalRunQuerySchema)) query: TemporalRunQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    const result = await this.workflowRunService.getRunResult(runId, query.temporalRunId, auth);
    return { runId, result };
  }

  @Get('/runs/:runId/config')
  @ApiOperation({ summary: 'Get workflow run configuration' })
  @ApiOkResponse({
    description: 'Inputs and version metadata captured for a workflow run',
    schema: runConfigSchema,
  })
  async config(@Param('runId') runId: string, @CurrentAuth() auth: AuthContext | null) {
    return this.workflowRunService.getRunConfig(runId, auth);
  }

  @Post('/runs/:runId/cancel')
  @ApiOperation({ summary: 'Cancel a workflow run' })
  @ApiOkResponse({
    description: 'Cancels a running workflow execution',
  })
  async cancel(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TemporalRunQuerySchema)) query: TemporalRunQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    await this.workflowRunService.cancelRun(runId, query.temporalRunId, auth);
    return { status: 'cancelled', runId };
  }
}
