import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  BadRequestException,
  HttpException,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  CreateWorkflowRequestDto,
  RunWorkflowRequestDto,
  RunWorkflowRequestSchema,
  UpdateWorkflowRequestDto,
  UpdateWorkflowMetadataDto,
  UpdateWorkflowMetadataSchema,
  WorkflowResponseDto,
  ServiceWorkflowResponse,
  WorkflowVersionResponseDto,
  WorkflowVersionSummaryDto,
  WorkflowRuntimeInputsResponseDto,
  ENTRY_POINT_COMPONENT_IDS,
  type RuntimeInput,
} from './dto/workflow-graph.dto';
import {
  SetWorkflowTagsDto,
  SetWorkflowTagsSchema,
  WorkflowTagsResponseDto,
} from './dto/workflow-tags.dto';
import { WorkflowsService } from './workflows.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { RequireWorkflowRole, WorkflowRoleGuard } from './workflow-role.guard';
import type { AppConfig } from '../config';

@ApiTags('workflows')
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new workflow' })
  @ApiCreatedResponse({ type: WorkflowResponseDto })
  async create(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: CreateWorkflowRequestDto,
  ): Promise<WorkflowResponseDto> {
    const serviceResponse = await this.workflowsService.create(body, auth);
    return this.transformServiceResponseToApi(serviceResponse);
  }

  @Put(':id')
  @UseGuards(WorkflowRoleGuard)
  @RequireWorkflowRole('ADMIN')
  @ApiOperation({ summary: 'Update a workflow' })
  @ApiOkResponse({ type: WorkflowResponseDto })
  async update(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body() body: UpdateWorkflowRequestDto,
  ): Promise<WorkflowResponseDto> {
    const serviceResponse = await this.workflowsService.update(id, body, auth);
    return this.transformServiceResponseToApi(serviceResponse);
  }

  @Patch(':id/metadata')
  @UseGuards(WorkflowRoleGuard)
  @RequireWorkflowRole('ADMIN')
  @ApiOperation({ summary: 'Update workflow metadata' })
  @ApiOkResponse({ type: WorkflowResponseDto })
  async updateMetadata(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkflowMetadataSchema)) body: UpdateWorkflowMetadataDto,
  ): Promise<WorkflowResponseDto> {
    const serviceResponse = await this.workflowsService.updateMetadata(id, body, auth);
    return this.transformServiceResponseToApi(serviceResponse);
  }

  @Get('summary')
  @ApiOperation({ summary: 'List workflow summaries' })
  @ApiQuery({
    name: 'tags',
    required: false,
    type: String,
    description:
      'Comma-separated tag names to filter by (intersection — workflows must have ALL tags)',
  })
  @ApiOkResponse({
    description: 'Lightweight workflow list without graph data',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          isSystem: { type: 'boolean' },
          templateId: { type: 'string', format: 'uuid', nullable: true },
          lastRun: { type: 'string', format: 'date-time', nullable: true },
          runCount: { type: 'integer' },
          nodeCount: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  })
  async listSummary(@CurrentAuth() auth: AuthContext | null, @Query('tags') tagsParam?: string) {
    const tags = this.parseTagsParam(tagsParam);
    return this.workflowsService.listSummary(auth, { tags });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a workflow by ID' })
  @ApiOkResponse({ type: WorkflowResponseDto })
  async findOne(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ): Promise<WorkflowResponseDto> {
    const serviceResponse = await this.workflowsService.findById(id, auth);
    return this.transformServiceResponseToApi(serviceResponse);
  }

  @Get(':id/runtime-inputs')
  @ApiOperation({ summary: 'Get workflow runtime inputs' })
  @ApiOkResponse({
    type: WorkflowRuntimeInputsResponseDto,
    description: 'Get the runtime inputs defined in the workflow Entry Point',
  })
  async getRuntimeInputs(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ): Promise<WorkflowRuntimeInputsResponseDto> {
    const workflow = await this.workflowsService.findById(id, auth);

    // Find the entry point node by checking the component type
    const entryNode = workflow.graph.nodes.find((node) =>
      (ENTRY_POINT_COMPONENT_IDS as readonly string[]).includes(node.type),
    );

    // Extract runtime inputs from the entry point's config
    const config = entryNode?.data?.config as Record<string, unknown> | undefined;
    const params = config?.params as Record<string, unknown> | undefined;
    const rawInputs = (params?.runtimeInputs as RuntimeInput[]) || [];

    // Normalize and validate the inputs
    const inputs: RuntimeInput[] = rawInputs.map((input) => ({
      id: input.id,
      label: input.label || input.id,
      type: input.type === 'string' ? 'text' : input.type,
      required: input.required ?? true,
      description: input.description,
      defaultValue: input.defaultValue,
    }));

    return {
      workflowId: workflow.id,
      inputs,
    };
  }

  @Get(':workflowId/versions')
  @ApiOperation({ summary: 'List all versions of a workflow' })
  @ApiOkResponse({ type: [WorkflowVersionSummaryDto] })
  async listVersions(
    @CurrentAuth() auth: AuthContext | null,
    @Param('workflowId') workflowId: string,
  ): Promise<WorkflowVersionSummaryDto[]> {
    return this.workflowsService.listVersions(workflowId, auth);
  }

  @Get(':workflowId/versions/:versionId')
  @ApiOperation({ summary: 'Get a specific workflow version' })
  @ApiOkResponse({ type: WorkflowVersionResponseDto })
  async findVersion(
    @CurrentAuth() auth: AuthContext | null,
    @Param('workflowId') workflowId: string,
    @Param('versionId') versionId: string,
  ): Promise<WorkflowVersionResponseDto> {
    return this.workflowsService.getWorkflowVersion(workflowId, versionId, auth);
  }

  @Delete(':id')
  @UseGuards(WorkflowRoleGuard)
  @RequireWorkflowRole('ADMIN')
  @ApiOperation({ summary: 'Delete a workflow' })
  @ApiOkResponse({ description: 'Workflow deleted successfully' })
  async remove(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    await this.workflowsService.delete(id, auth);
    return { status: 'deleted', id };
  }

  @Post(':id/commit')
  @UseGuards(WorkflowRoleGuard)
  @RequireWorkflowRole('ADMIN')
  @ApiOperation({ summary: 'Commit a workflow version' })
  @ApiOkResponse({
    description: 'Compiled workflow definition',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string', nullable: true },
        entrypoint: {
          type: 'object',
          properties: {
            ref: { type: 'string' },
          },
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              componentId: { type: 'string' },
              params: {
                type: 'object',
                additionalProperties: true,
              },
              dependsOn: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
        config: {
          type: 'object',
          properties: {
            environment: { type: 'string' },
            timeoutSeconds: { type: 'number' },
          },
        },
      },
    },
  })
  async commit(@Param('id') id: string, @CurrentAuth() auth: AuthContext | null) {
    try {
      return await this.workflowsService.commit(id, auth);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      const message = error instanceof Error ? error.message : 'Commit failed';
      // Surface compile/validation details to the client for better UX
      throw new BadRequestException(message);
    }
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Run a workflow' })
  @ApiCreatedResponse({
    description: 'Workflow execution result',
    schema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Temporal workflow identifier' },
        workflowId: { type: 'string', description: 'Workflow record id' },
        temporalRunId: {
          type: 'string',
          description: 'Temporal first execution run id',
        },
        taskQueue: {
          type: 'string',
          description: 'Temporal task queue used for execution',
        },
        workflowVersionId: {
          type: 'string',
          description: 'Workflow version identifier used for execution',
        },
        workflowVersion: {
          type: 'integer',
          description: 'Workflow version number used for execution',
        },
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
      },
    },
  })
  async run(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RunWorkflowRequestSchema))
    body: RunWorkflowRequestDto,
    @Headers() headers?: Record<string, string | string[] | undefined>,
  ) {
    try {
      const idempotencyKey = this.extractIdempotencyKey(headers);
      const prepared = await this.workflowsService.prepareRunPayload(
        id,
        {
          inputs: body.inputs,
          versionId: body.versionId,
          version: body.version,
        },
        auth,
        { idempotencyKey },
      );

      return await this.workflowsService.startPreparedRun(prepared);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;

      // Extract detailed error information
      const message = error instanceof Error ? error.message : 'Failed to run workflow';
      const errorDetails: {
        message: string;
        error: string;
        statusCode: number;
        stack?: string;
        cause?: unknown;
      } = {
        message,
        error: 'Bad Request',
        statusCode: 400,
      };

      // Include stack trace and cause only in development to avoid leaking internal details
      const appCfg = this.configService.get<AppConfig>('app')!;
      const isDevelopment = appCfg.nodeEnv !== 'production';
      if (isDevelopment) {
        if (error instanceof Error && error.stack) {
          errorDetails.stack = error.stack;
        }

        if (error instanceof Error && (error as Error & { cause?: unknown }).cause) {
          errorDetails.cause = (error as Error & { cause?: unknown }).cause;
        }
      }

      throw new BadRequestException(errorDetails);
    }
  }

  @Get(':id/tags')
  @ApiOperation({ summary: 'Get tags for a workflow' })
  @ApiOkResponse({ type: WorkflowTagsResponseDto })
  async getWorkflowTags(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ): Promise<WorkflowTagsResponseDto> {
    return this.workflowsService.getWorkflowTags(auth, id);
  }

  @Patch(':id/tags')
  @UseGuards(WorkflowRoleGuard)
  @RequireWorkflowRole('ADMIN')
  @ApiOperation({ summary: 'Set tags for a workflow (replaces all existing tags)' })
  @ApiBody({ type: SetWorkflowTagsDto })
  @ApiOkResponse({ type: WorkflowTagsResponseDto })
  async setWorkflowTags(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetWorkflowTagsSchema)) body: SetWorkflowTagsDto,
  ): Promise<WorkflowTagsResponseDto> {
    return this.workflowsService.setWorkflowTags(auth, id, body.tags);
  }

  @Get()
  @ApiOperation({ summary: 'List all workflows' })
  @ApiQuery({
    name: 'tags',
    required: false,
    type: String,
    description:
      'Comma-separated tag names to filter by (intersection — workflows must have ALL tags)',
  })
  @ApiOkResponse({ type: [WorkflowResponseDto] })
  async findAll(
    @CurrentAuth() auth: AuthContext | null,
    @Query('tags') tagsParam?: string,
  ): Promise<WorkflowResponseDto[]> {
    const tags = this.parseTagsParam(tagsParam);
    const serviceResponses = await this.workflowsService.list(auth, { tags });
    return serviceResponses.map((response) => this.transformServiceResponseToApi(response));
  }

  private transformServiceResponseToApi(
    serviceResponse: ServiceWorkflowResponse,
  ): WorkflowResponseDto {
    return {
      ...serviceResponse,
      lastRun: serviceResponse.lastRun?.toISOString() ?? null,
      createdAt: serviceResponse.createdAt.toISOString(),
      updatedAt: serviceResponse.updatedAt.toISOString(),
    };
  }

  private parseTagsParam(tagsParam?: string): string[] | undefined {
    if (!tagsParam) return undefined;
    const tags = tagsParam
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    return tags.length > 0 ? tags : undefined;
  }

  private extractIdempotencyKey(
    headers: Record<string, string | string[] | undefined> | undefined,
  ): string | undefined {
    if (!headers) {
      return undefined;
    }

    const normalized = Object.entries(headers).reduce<
      Record<string, string | string[] | undefined>
    >((acc, [key, value]) => {
      acc[key.toLowerCase()] = value;
      return acc;
    }, {});

    for (const candidate of ['idempotency-key', 'x-idempotency-key']) {
      const raw = normalized[candidate];
      if (Array.isArray(raw)) {
        const first = raw.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
        if (first) {
          return first;
        }
      } else if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw;
      }
    }

    return undefined;
  }
}
