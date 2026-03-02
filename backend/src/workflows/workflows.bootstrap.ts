import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { WorkflowsService } from './workflows.service';
import { WorkflowVersionService } from './workflow-version.service';
import type { AppConfig, TemporalTaskConfig } from '../config';

const DEMO_WORKFLOW_NAME = 'Temporal Demo Workflow';

@Injectable()
export class WorkflowsBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowsBootstrapService.name);

  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly workflowVersionService: WorkflowVersionService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.shouldBootstrap()) {
      return;
    }

    try {
      const workflowId = await this.ensureDemoWorkflow();
      const run = await this.workflowsService.run(workflowId, {
        inputs: { payload: { message: 'Temporal bootstrap demo run' } },
      });

      this.logger.log(
        `Bootstrapped Temporal demo run ${run.runId} (workflow=${workflowId}, queue=${run.taskQueue})`,
      );
    } catch (error: unknown) {
      this.logger.error(
        'Failed to bootstrap Temporal demo workflow',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private shouldBootstrap(): boolean {
    const appCfg = this.configService.get<AppConfig>('app')!;
    if (appCfg.nodeEnv === 'test') {
      return false;
    }

    const temporalCfg = this.configService.get<TemporalTaskConfig>('temporalTask')!;
    return temporalCfg.bootstrapDemo;
  }

  private async ensureDemoWorkflow(): Promise<string> {
    const existing = (await this.workflowsService.list()).find(
      (workflow) => workflow.name === DEMO_WORKFLOW_NAME,
    );

    if (existing) {
      await this.workflowVersionService.commit(existing.id);
      return existing.id;
    }

    const created = await this.workflowsService.create({
      name: DEMO_WORKFLOW_NAME,
      description: 'Auto-generated workflow to verify Temporal integration',
      nodes: [
        {
          id: 'trigger',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: {
            label: 'Entry Point',
            config: {
              params: {},
              inputOverrides: {
                runtimeInputs: [{ id: 'fileId', label: 'File ID', type: 'file', required: true }],
              },
            },
          },
        },
        {
          id: 'loader',
          type: 'core.file.loader',
          position: { x: 200, y: 0 },
          data: {
            label: 'Load Sample File',
            config: {
              params: {},
              inputOverrides: { fileId: '00000000-0000-4000-8000-000000000001' },
            },
          },
        },
      ],
      edges: [
        {
          id: 'trigger-loader',
          source: 'trigger',
          target: 'loader',
          sourceHandle: 'fileId',
          targetHandle: 'fileId',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });

    await this.workflowVersionService.commit(created.id);
    return created.id;
  }
}
