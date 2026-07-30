import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OutboxRepository } from './outbox.repository';

const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 8;
const CLEANUP_BATCH_SIZE = 10_000;
const MAX_BATCHES_PER_CLEANUP = 20;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

@Injectable()
export class OutboxReceiptCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxReceiptCleanupService.name);
  private readonly retentionDays: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly repository: OutboxRepository,
    configService: ConfigService,
  ) {
    const configured = Number(
      configService.get<string | number>('TELEMETRY_KAFKA_RECEIPT_RETENTION_DAYS') ??
        DEFAULT_RETENTION_DAYS,
    );
    if (!Number.isInteger(configured) || configured < MIN_RETENTION_DAYS) {
      throw new Error(
        `TELEMETRY_KAFKA_RECEIPT_RETENTION_DAYS must be at least ${MIN_RETENTION_DAYS} days`,
      );
    }
    const replayRetentionDays = Number(
      configService.get<string | number>('TELEMETRY_KAFKA_REPLAY_RETENTION_DAYS') ?? 7,
    );
    if (
      !Number.isInteger(replayRetentionDays) ||
      replayRetentionDays < 1 ||
      configured <= replayRetentionDays
    ) {
      throw new Error(
        'TELEMETRY_KAFKA_RECEIPT_RETENTION_DAYS must exceed TELEMETRY_KAFKA_REPLAY_RETENTION_DAYS',
      );
    }
    this.retentionDays = configured;
  }

  onApplicationBootstrap(): void {
    this.runScheduledCleanup();
    this.timer = setInterval(() => this.runScheduledCleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async cleanupOnce(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.retentionDays * 24 * 60 * 60 * 1_000);
    const receiptsRemoved = await this.drainBatches(
      (batchCutoff, batchSize) => this.repository.purgeKafkaReceiptsBefore(batchCutoff, batchSize),
      cutoff,
    );
    const publicationsRemoved = await this.drainBatches(
      (batchCutoff, batchSize) =>
        this.repository.purgeCompletedTelemetryPublicationsBefore(batchCutoff, batchSize),
      cutoff,
    );
    const removed = receiptsRemoved + publicationsRemoved;
    if (removed > 0) {
      this.logger.log(
        `Purged ${receiptsRemoved} Kafka ingest receipts and ${publicationsRemoved} completed durable telemetry publications older than ${this.retentionDays} days`,
      );
    }
    return removed;
  }

  private async drainBatches(
    purge: (cutoff: Date, limit: number) => Promise<number>,
    cutoff: Date,
  ): Promise<number> {
    let removed = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_CLEANUP; batch += 1) {
      const batchRemoved = await purge(cutoff, CLEANUP_BATCH_SIZE);
      removed += batchRemoved;
      if (batchRemoved < CLEANUP_BATCH_SIZE) {
        break;
      }
    }
    return removed;
  }

  private runScheduledCleanup(): void {
    void this.cleanupOnce().catch((error: unknown) => {
      this.logger.error(
        `Kafka receipt cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
