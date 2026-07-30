import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface ClaimedOutboxEvent {
  id: string;
  eventType: string;
  organizationId: string | null;
  aggregateType: string;
  aggregateId: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export interface RescheduleOutboxEventInput {
  dead: boolean;
  delayMs: number;
  error: string;
}

export abstract class OutboxRepositoryPort {
  abstract claimBatch(workerId: string, limit: number): Promise<ClaimedOutboxEvent[]>;
  abstract renewLease(eventId: string, workerId: string): Promise<boolean>;
  abstract markCompleted(eventId: string, workerId: string): Promise<void>;
  abstract reschedule(
    eventId: string,
    workerId: string,
    input: RescheduleOutboxEventInput,
  ): Promise<void>;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1_000;
const MAX_ERROR_LENGTH = 4_000;
export const OUTBOX_LEASE_MS = 5 * 60 * 1_000;
export const OUTBOX_LEASE_HEARTBEAT_INTERVAL_MS = 60 * 1_000;
export const OUTBOX_DISPATCHER_SCHEDULER = Symbol('OUTBOX_DISPATCHER_SCHEDULER');

export interface OutboxIntervalHandle {
  unref?(): void;
}

export interface OutboxDispatcherScheduler {
  setInterval(callback: () => void, intervalMs: number): OutboxIntervalHandle;
  clearInterval(handle: OutboxIntervalHandle): void;
}

interface ActiveLeaseHeartbeat {
  stop(): Promise<Error | undefined>;
}

const SYSTEM_SCHEDULER: OutboxDispatcherScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

@Injectable()
export class OutboxDispatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private readonly workerId = randomUUID();
  private readonly scheduler: OutboxDispatcherScheduler;
  private draining = false;
  private timer: OutboxIntervalHandle | undefined;

  constructor(
    private readonly repository: OutboxRepositoryPort,
    private readonly eventEmitter: EventEmitter2,
    @Optional()
    @Inject(OUTBOX_DISPATCHER_SCHEDULER)
    scheduler?: OutboxDispatcherScheduler,
  ) {
    this.scheduler = scheduler ?? SYSTEM_SCHEDULER;
  }

  onApplicationBootstrap(): void {
    this.runScheduledDrain();
    this.timer = this.scheduler.setInterval(
      () => this.runScheduledDrain(),
      DEFAULT_POLL_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      this.scheduler.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async drainOnce(batchSize = DEFAULT_BATCH_SIZE): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      const events = await this.repository.claimBatch(this.workerId, batchSize);
      await Promise.all(events.map((event) => this.dispatch(event)));
    } finally {
      this.draining = false;
    }
  }

  private async dispatch(event: ClaimedOutboxEvent): Promise<void> {
    const heartbeat = this.startLeaseHeartbeat(event.id);
    try {
      const listenerResults = await this.eventEmitter.emitAsync(event.eventType, {
        ...event.payload,
        outbox: {
          eventId: event.id,
          dedupeKey: event.dedupeKey,
          attempt: event.attempts,
        },
      });
      if (listenerResults.length === 0) {
        throw new Error(`No listener registered for outbox event type ${event.eventType}`);
      }
      const heartbeatError = await heartbeat.stop();
      if (heartbeatError) {
        throw heartbeatError;
      }
      await this.repository.markCompleted(event.id, this.workerId);
    } catch (error: unknown) {
      const heartbeatError = await heartbeat.stop();
      const dead = event.attempts >= event.maxAttempts;
      const message = this.errorMessage(heartbeatError ?? error);
      await this.repository.reschedule(event.id, this.workerId, {
        dead,
        delayMs: dead ? 0 : this.retryDelayMs(event.attempts),
        error: message,
      });

      const detail = `event=${event.id} type=${event.eventType} attempt=${event.attempts}/${event.maxAttempts}`;
      if (dead) {
        this.logger.error(`Outbox event dead-lettered ${detail}: ${message}`);
      } else {
        this.logger.warn(`Outbox event rescheduled ${detail}: ${message}`);
      }
    }
  }

  private startLeaseHeartbeat(eventId: string): ActiveLeaseHeartbeat {
    let stopped = false;
    let failure: Error | undefined;
    let renewal = Promise.resolve();

    const renew = () => {
      if (stopped || failure) return;
      renewal = renewal.then(async () => {
        if (failure) return;
        try {
          const renewed = await this.repository.renewLease(eventId, this.workerId);
          if (!renewed) {
            failure = new Error(`Outbox lease ownership lost for event ${eventId}`);
          }
        } catch (error: unknown) {
          failure = new Error(
            `Outbox lease renewal failed for event ${eventId}: ${this.errorMessage(error)}`,
          );
        }
      });
    };

    const timer = this.scheduler.setInterval(renew, OUTBOX_LEASE_HEARTBEAT_INTERVAL_MS);
    timer.unref?.();

    return {
      stop: async () => {
        if (!stopped) {
          stopped = true;
          this.scheduler.clearInterval(timer);
        }
        await renewal;
        return failure;
      },
    };
  }

  private runScheduledDrain(): void {
    void this.drainOnce().catch((error: unknown) => {
      this.logger.error(
        `Scheduled outbox drain failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private retryDelayMs(attempt: number): number {
    const exponent = Math.max(0, attempt - 1);
    return Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, MAX_ERROR_LENGTH);
  }
}
