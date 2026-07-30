import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { WorkflowExecutionStatusName } from '@temporalio/client';

import { TemporalService } from '../temporal/temporal.service';
import type { WorkflowRunRecord } from '../database/schema';
import {
  WorkflowRunRepository,
  type UnfinalizedRunCursor,
} from './repository/workflow-run.repository';
import type { ReportableTerminalStatus } from './dto/run-finalization.dto';

const DEFAULT_RECONCILE_LIMIT = 50;
const MAX_CONCURRENCY = 8;
const RECONCILE_INTERVAL_MS = 30_000;

@Injectable()
export class RunTerminalReconcilerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RunTerminalReconcilerService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private reconciling = false;
  private cursor: UnfinalizedRunCursor | undefined;

  constructor(
    private readonly runRepository: WorkflowRunRepository,
    private readonly temporalService: TemporalService,
  ) {}

  onApplicationBootstrap(): void {
    this.runScheduledReconciliation();
    this.timer = setInterval(() => this.runScheduledReconciliation(), RECONCILE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async reconcileOnce(limit = DEFAULT_RECONCILE_LIMIT): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
      let candidates = await this.runRepository.listUnfinalized({
        limit: boundedLimit,
        ...(this.cursor ? { after: this.cursor } : {}),
      });
      if (candidates.length === 0 && this.cursor) {
        this.cursor = undefined;
        candidates = await this.runRepository.listUnfinalized({ limit: boundedLimit });
      }

      let candidateIndex = 0;
      const workerCount = Math.min(MAX_CONCURRENCY, candidates.length);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (candidateIndex < candidates.length) {
            const candidate = candidates[candidateIndex++];
            if (candidate) {
              await this.reconcileRun(candidate);
            }
          }
        }),
      );
      const lastCandidate = candidates.at(-1);
      this.cursor =
        candidates.length === boundedLimit && lastCandidate
          ? { createdAt: lastCandidate.createdAt, runId: lastCandidate.runId }
          : undefined;
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileRun(run: WorkflowRunRecord): Promise<void> {
    const organizationId = run.organizationId;
    if (!organizationId) return;

    try {
      const temporal = await this.temporalService.describeWorkflow({
        workflowId: run.runId,
        runId: run.temporalRunId ?? undefined,
      });
      const status = this.toTerminalStatus(temporal.status);
      if (!status) return;

      await this.runRepository.finalizeTerminalRun({
        runId: run.runId,
        organizationId,
        status,
        completedAt: temporal.closeTime ? new Date(temporal.closeTime) : new Date(),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to reconcile terminal status for run ${run.runId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private toTerminalStatus(status: WorkflowExecutionStatusName): ReportableTerminalStatus | null {
    switch (status) {
      case 'COMPLETED':
      case 'FAILED':
      case 'TERMINATED':
      case 'TIMED_OUT':
        return status;
      case 'CANCELLED':
        return 'CANCELLED';
      default:
        return null;
    }
  }

  private runScheduledReconciliation(): void {
    void this.reconcileOnce().catch((error: unknown) => {
      this.logger.error(
        `Terminal run reconciliation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}
