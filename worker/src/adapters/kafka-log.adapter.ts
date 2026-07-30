import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import { ConfigurationError, LOG_CHUNK_SIZE_CHARS } from '@sentris/component-sdk';
import {
  DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS,
  durableTelemetryKafkaProducerConfig,
} from '@sentris/shared';
import { createHash } from 'node:crypto';

import type { WorkflowLogEntry, WorkflowLogSink } from '../temporal/types';
import {
  publishWithDurableFallback,
  type DurableKafkaFallback,
} from '../common/durable-kafka-fallback';

export interface KafkaLogAdapterConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  logLevel?: keyof typeof KafkaLogLevel;
}

type SerializedLogEntry = Omit<WorkflowLogEntry, 'eventId' | 'timestamp'> & {
  eventId: string;
  timestamp: string;
};

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export class KafkaLogAdapter implements WorkflowLogSink {
  private readonly producer: Producer;
  private connectPromise: Promise<void> | undefined;
  private connected = false;

  constructor(
    private readonly config: KafkaLogAdapterConfig,
    private readonly fallback?: DurableKafkaFallback,
    private readonly logger: Pick<Console, 'error'> = console,
  ) {
    if (!config.brokers.length) {
      throw new ConfigurationError('KafkaLogAdapter requires at least one broker', {
        configKey: 'brokers',
        details: { brokers: config.brokers },
      });
    }

    const kafka = new Kafka({
      clientId: config.clientId ?? 'sentris-worker',
      brokers: config.brokers,
      requestTimeout: DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS,
      logLevel: config.logLevel ? KafkaLogLevel[config.logLevel] : KafkaLogLevel.NOTHING,
    });

    this.producer = kafka.producer(durableTelemetryKafkaProducerConfig());
  }

  async append(entry: WorkflowLogEntry): Promise<void> {
    if (!entry.message || entry.message.trim().length === 0) {
      return;
    }

    // Chunk message if it's too large to prevent Kafka/Loki size limit errors.
    const messages: string[] = [];

    if (entry.message.length <= LOG_CHUNK_SIZE_CHARS) {
      messages.push(entry.message);
    } else {
      const totalChars = entry.message.length;
      const totalChunks = Math.ceil(totalChars / LOG_CHUNK_SIZE_CHARS);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * LOG_CHUNK_SIZE_CHARS;
        const chunk = entry.message.substring(start, start + LOG_CHUNK_SIZE_CHARS);
        const indicator = ` [Chunk ${i + 1}/${totalChunks}]`;
        messages.push(chunk + indicator);
      }
    }

    const timestamp = (entry.timestamp ?? new Date()).toISOString();

    try {
      // Send all chunks
      for (const [chunkIndex, msg] of messages.entries()) {
        const eventId =
          entry.eventId && messages.length === 1
            ? entry.eventId
            : entry.eventId
              ? `log:chunk:${createHash('sha256')
                  .update(JSON.stringify([entry.eventId, chunkIndex + 1, messages.length]))
                  .digest('hex')}`
              : `log:${createHash('sha256')
                  .update(
                    JSON.stringify(
                      canonicalize({
                        ...entry,
                        eventId: undefined,
                        message: msg,
                        timestamp,
                      }),
                    ),
                  )
                  .digest('hex')}`;
        const payload: SerializedLogEntry = {
          ...entry,
          eventId,
          message: msg,
          timestamp,
        };

        const value = JSON.stringify(payload);
        await publishWithDurableFallback({
          publish: async () => {
            await this.ensureConnected();
            await this.producer.send({
              topic: this.config.topic,
              messages: [
                {
                  value,
                },
              ],
            });
          },
          fallback: this.fallback,
          publication: {
            topic: this.config.topic,
            key: null,
            value,
            organizationId: entry.organizationId ?? null,
          },
          source: 'KafkaLogAdapter',
          logger: this.logger,
        });
      }
    } catch (error: unknown) {
      this.logger.error('[KafkaLogAdapter] Failed to send log entry', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.connectPromise?.catch(() => undefined);
    if (!this.connected) return;
    await this.producer.disconnect();
    this.connected = false;
    this.connectPromise = undefined;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connectPromise) {
      const attempt = this.producer.connect();
      this.connectPromise = attempt;
      try {
        await attempt;
        this.connected = true;
      } catch (error: unknown) {
        if (this.connectPromise === attempt) {
          this.connectPromise = undefined;
        }
        this.logger.error('[KafkaLogAdapter] Failed to connect to brokers', error);
        throw error;
      }
      return;
    }
    await this.connectPromise;
  }
}
