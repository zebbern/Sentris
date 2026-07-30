import type { Consumer } from 'kafkajs';

export interface KafkaConsumerHealthReporter {
  connecting(): void;
  running(): void;
  failed(error: unknown): void;
  stopped(): void;
}

interface KafkaConsumerLifecycleLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

interface KafkaConsumerBackoff {
  initialMs: number;
  maxMs: number;
  jitterRatio: number;
}

interface KafkaConsumerLifecycleOptions {
  name: string;
  createConsumer(): Consumer;
  startConsumer(consumer: Consumer): Promise<void>;
  health?: KafkaConsumerHealthReporter;
  logger?: KafkaConsumerLifecycleLogger;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  backoff?: Partial<KafkaConsumerBackoff>;
  disconnectTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
  failureResetMs?: number;
  now?: () => number;
}

const DEFAULT_BACKOFF: KafkaConsumerBackoff = {
  initialMs: 250,
  maxMs: 30_000,
  jitterRatio: 0.2,
};
const DEFAULT_DISCONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;
const DEFAULT_FAILURE_RESET_MS = 120_000;

/**
 * Owns one required Kafka consumer for its entire backend lifetime.
 *
 * KafkaJS retries individual broker operations; this supervisor handles the
 * larger lifecycle by disposing a failed consumer and constructing a fresh one.
 */
export class KafkaConsumerLifecycleSupervisor {
  private readonly backoff: KafkaConsumerBackoff;
  private readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly disconnectTimeoutMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly failureResetMs: number;
  private readonly now: () => number;
  private readonly disconnects = new WeakMap<Consumer, Promise<void>>();
  private abortController: AbortController | undefined;
  private loopPromise: Promise<void> | undefined;
  private consumer: Consumer | undefined;

  constructor(private readonly options: KafkaConsumerLifecycleOptions) {
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.sleep = options.sleep ?? abortableSleep;
    this.random = options.random ?? Math.random;
    this.disconnectTimeoutMs = Math.max(
      0,
      options.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS,
    );
    this.heartbeatTimeoutMs = Math.max(
      0,
      options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
    );
    this.failureResetMs = Math.max(0, options.failureResetMs ?? DEFAULT_FAILURE_RESET_MS);
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.loopPromise) {
      return;
    }

    this.abortController = new AbortController();
    this.loopPromise = this.run(this.abortController.signal);
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    if (this.consumer) {
      await this.disconnect(this.consumer);
    }
    await this.loopPromise;
  }

  private async run(signal: AbortSignal): Promise<void> {
    let consecutiveFailures = 0;

    try {
      while (!signal.aborted) {
        this.options.health?.connecting();
        let consumer: Consumer | undefined;
        let failure: unknown;
        let monitor: ReturnType<typeof monitorConsumer> | undefined;

        try {
          consumer = this.options.createConsumer();
          this.consumer = consumer;
          monitor = monitorConsumer(consumer, signal, this.heartbeatTimeoutMs, this.now);
          await this.options.startConsumer(consumer);

          if (signal.aborted) {
            continue;
          }

          this.options.health?.running();
          monitor.armHeartbeatWatchdog();
          failure = await monitor.failure;
        } catch (error: unknown) {
          failure = error;
        } finally {
          monitor?.close();
        }

        if (!signal.aborted) {
          this.options.health?.failed(failure);
          this.options.logger?.warn(
            `Kafka ${this.options.name} consumer unavailable; recreating after backoff: ${errorMessage(failure)}`,
          );
        }

        if (consumer) {
          await this.disconnect(consumer);
          if (this.consumer === consumer) {
            this.consumer = undefined;
          }
        }

        if (signal.aborted) {
          break;
        }

        if (monitor?.hasSustainedHeartbeats(this.failureResetMs)) {
          consecutiveFailures = 0;
        }
        const delay = this.backoffDelay(consecutiveFailures);
        consecutiveFailures += 1;
        await this.sleep(delay, signal);
      }
    } catch (error: unknown) {
      if (!signal.aborted) {
        this.options.health?.failed(error);
        this.options.logger?.error(`Kafka ${this.options.name} lifecycle supervisor failed`, error);
      }
    } finally {
      this.options.health?.stopped();
    }
  }

  private backoffDelay(failureCount: number): number {
    const exponential = Math.min(
      this.backoff.maxMs,
      this.backoff.initialMs * 2 ** Math.min(failureCount, 30),
    );
    const normalizedRandom = Math.min(1, Math.max(0, this.random()));
    const jitterMultiplier = 1 + (normalizedRandom * 2 - 1) * Math.max(0, this.backoff.jitterRatio);
    return Math.max(0, Math.min(this.backoff.maxMs, Math.round(exponential * jitterMultiplier)));
  }

  private disconnect(consumer: Consumer): Promise<void> {
    const existing = this.disconnects.get(consumer);
    if (existing) {
      return existing;
    }

    const attempt = Promise.resolve()
      .then(() => consumer.disconnect())
      .catch((error: unknown) => {
        this.options.logger?.error(
          `Failed to disconnect Kafka ${this.options.name} consumer`,
          error,
        );
      });
    const disconnect = settleWithin(attempt, this.disconnectTimeoutMs, () => {
      this.options.logger?.error(
        `Kafka ${this.options.name} consumer disconnect exceeded ${this.disconnectTimeoutMs}ms; abandoning cleanup`,
      );
    });
    this.disconnects.set(consumer, disconnect);
    return disconnect;
  }
}

function settleWithin(
  promise: Promise<void>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<void> {
  if (timeoutMs === 0) {
    onTimeout();
    return Promise.resolve();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve();
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function monitorConsumer(
  consumer: Consumer,
  signal: AbortSignal,
  heartbeatTimeoutMs: number,
  now: () => number,
): {
  failure: Promise<unknown>;
  armHeartbeatWatchdog(): void;
  hasSustainedHeartbeats(minimumMs: number): boolean;
  close(): void;
} {
  let settled = false;
  let heartbeatWatchdogArmed = false;
  let firstHeartbeatAt: number | undefined;
  let resolveFailure!: (error: unknown) => void;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  const failure = new Promise<unknown>((resolve) => {
    resolveFailure = resolve;
  });
  const settle = (error: unknown) => {
    if (settled) return;
    settled = true;
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    resolveFailure(error);
  };
  const armHeartbeatWatchdog = () => {
    if (settled) {
      return;
    }
    heartbeatWatchdogArmed = true;
    if (heartbeatTimeoutMs === 0) return;
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
    }
    heartbeatTimer = setTimeout(() => {
      settle(new Error(`Kafka consumer heartbeat absent for ${heartbeatTimeoutMs}ms`));
    }, heartbeatTimeoutMs);
  };
  const onHeartbeat = () => {
    if (!heartbeatWatchdogArmed || settled) return;
    firstHeartbeatAt ??= now();
    armHeartbeatWatchdog();
  };
  const removeCrash = consumer.on(consumer.events.CRASH, (event) => {
    settle(event.payload.error);
  });
  const removeDisconnect = consumer.on(consumer.events.DISCONNECT, () => {
    settle(new Error('Kafka consumer disconnected'));
  });
  const removeStop = consumer.on(consumer.events.STOP, () => {
    settle(new Error('Kafka consumer stopped'));
  });
  const removeHeartbeat = consumer.on(consumer.events.HEARTBEAT, onHeartbeat);
  const onAbort = () => settle(undefined);
  signal.addEventListener('abort', onAbort, { once: true });

  return {
    failure,
    armHeartbeatWatchdog,
    hasSustainedHeartbeats(minimumMs: number) {
      return firstHeartbeatAt !== undefined && now() - firstHeartbeatAt >= minimumMs;
    },
    close() {
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = undefined;
      }
      removeCrash();
      removeDisconnect();
      removeStop();
      removeHeartbeat();
      signal.removeEventListener('abort', onAbort);
    },
  };
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown failure');
}
