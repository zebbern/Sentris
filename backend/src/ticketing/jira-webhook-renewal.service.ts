import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { TicketingRepository } from './ticketing.repository';

const JIRA_WEBHOOK_RENEW_AFTER_DAYS = 20;
const RENEWAL_BATCH_SIZE = 100;
const RENEWAL_INTERVAL_MS = 6 * 60 * 60 * 1_000;

@Injectable()
export class JiraWebhookRenewalService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JiraWebhookRenewalService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private renewing = false;

  constructor(private readonly repository: TicketingRepository) {}

  onApplicationBootstrap(): void {
    this.runScheduledRenewal();
    this.timer = setInterval(() => this.runScheduledRenewal(), RENEWAL_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async renewOnce(now = new Date()): Promise<number> {
    if (this.renewing) {
      return 0;
    }
    this.renewing = true;
    try {
      const cutoff = new Date(now.getTime() - JIRA_WEBHOOK_RENEW_AFTER_DAYS * 24 * 60 * 60 * 1_000);
      const queued = await this.repository.queueDueJiraWebhookRenewals(cutoff, RENEWAL_BATCH_SIZE);
      if (queued > 0) {
        this.logger.log(`Queued ${queued} due Jira webhook renewal(s)`);
      }
      return queued;
    } finally {
      this.renewing = false;
    }
  }

  private runScheduledRenewal(): void {
    void this.renewOnce().catch((error: unknown) => {
      this.logger.error(
        `Jira webhook renewal scan failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}
