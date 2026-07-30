import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationDeliveryRepository } from './repository/notification-delivery.repository';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
const CLEANUP_BATCH_SIZE = 1_000;
const MAX_BATCHES_PER_CLEANUP = 10;

@Injectable()
export class NotificationDeliveryRetentionService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationDeliveryRetentionService.name);
  private readonly retentionDays: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly repository: NotificationDeliveryRepository,
    configService: ConfigService,
  ) {
    this.retentionDays = configService.get<number>('NOTIFICATION_DELIVERY_RETENTION_DAYS', 90);
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
    let removed = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_CLEANUP; batch += 1) {
      const batchRemoved = await this.repository.purgeResolvedBefore(cutoff, CLEANUP_BATCH_SIZE);
      removed += batchRemoved;
      if (batchRemoved < CLEANUP_BATCH_SIZE) {
        break;
      }
    }
    if (removed > 0) {
      this.logger.log(
        `Purged ${removed} safely resolved notification deliveries older than ${this.retentionDays} days`,
      );
    }
    return removed;
  }

  private runScheduledCleanup(): void {
    void this.cleanupOnce().catch((error: unknown) => {
      this.logger.error(
        `Notification delivery cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}
