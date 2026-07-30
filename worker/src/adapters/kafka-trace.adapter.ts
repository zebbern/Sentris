import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import type { ITraceService, TraceEvent } from '@sentris/component-sdk';
import { ConfigurationError, MAX_KAFKA_MESSAGE_BYTES } from '@sentris/component-sdk';
import {
  DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS,
  durableTelemetryKafkaProducerConfig,
} from '@sentris/shared';
import { createHash } from 'node:crypto';
import {
  publishWithDurableFallback,
  type DurableKafkaFallback,
} from '../common/durable-kafka-fallback';

const TRACE_PREVIEW_CHARS = 12_000;
const TRACE_FINAL_PREVIEW_CHARS = 2_000;

interface KafkaTraceAdapterConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  logLevel?: keyof typeof KafkaLogLevel;
}

interface RunMetadata {
  workflowId?: string;
  organizationId?: string | null;
}

interface SerializedTraceEvent {
  eventId: string;
  runId: string;
  workflowId: string | null;
  organizationId: string | null;
  type: TraceEvent['type'];
  nodeRef: string;
  timestamp: string;
  level: TraceEvent['level'];
  message?: string;
  error?: TraceEvent['error'];
  outputSummary?: unknown;
  data?: Record<string, unknown> | null;
  sequence: number;
}

export class KafkaTraceAdapter implements ITraceService {
  private readonly producer: Producer;
  private connectPromise: Promise<void> | undefined;
  private connected = false;

  constructor(
    private readonly config: KafkaTraceAdapterConfig,
    private readonly logger: Pick<Console, 'log' | 'error'> = console,
    private readonly fallback?: DurableKafkaFallback,
  ) {
    if (!config.brokers.length) {
      throw new ConfigurationError('KafkaTraceAdapter requires at least one broker', {
        configKey: 'brokers',
        details: { brokers: config.brokers },
      });
    }

    const kafka = new Kafka({
      clientId: config.clientId ?? 'sentris-worker-events',
      brokers: config.brokers,
      requestTimeout: DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS,
      logLevel: config.logLevel ? KafkaLogLevel[config.logLevel] : KafkaLogLevel.NOTHING,
    });

    this.producer = kafka.producer(durableTelemetryKafkaProducerConfig());
  }

  setRunMetadata(_runId: string, _metadata: RunMetadata): void {
    // Compatibility hook for existing workflow histories. Trace identity is
    // carried on every event so delivery remains correct after worker restarts.
  }

  finalizeRun(_runId: string): void {
    // Compatibility hook; no process-local run state is retained.
  }

  async close(): Promise<void> {
    await this.connectPromise?.catch(() => undefined);
    if (!this.connected) return;
    await this.producer.disconnect();
    this.connected = false;
    this.connectPromise = undefined;
  }

  async record(event: TraceEvent): Promise<void> {
    const eventId = event.eventId ?? this.fallbackEventId(event);
    const sequence =
      event.sequence && Number.isInteger(event.sequence) && event.sequence > 0
        ? event.sequence
        : this.fallbackSequence(eventId);

    const payload: SerializedTraceEvent = {
      eventId,
      runId: event.runId,
      workflowId: event.workflowId ?? null,
      organizationId: event.organizationId ?? null,
      type: event.type,
      nodeRef: event.nodeRef,
      timestamp: event.timestamp,
      level: event.level,
      message: event.message,
      error: event.error,
      outputSummary: event.outputSummary,
      data: this.packData(event),
      sequence,
    };

    const message = this.serializeForKafka(payload);

    try {
      await publishWithDurableFallback({
        publish: async () => {
          await this.ensureConnected();
          await this.producer.send({
            topic: this.config.topic,
            messages: [
              {
                key: event.runId,
                value: message,
              },
            ],
          });
        },
        fallback: this.fallback,
        publication: {
          topic: this.config.topic,
          key: event.runId,
          value: message,
          organizationId: event.organizationId ?? null,
        },
        source: 'KafkaTraceAdapter',
        logger: this.logger,
      });
    } catch (error: unknown) {
      this.logger.error(
        '[KafkaTraceAdapter] CRITICAL: Failed to send trace event after producer retries.',
        error,
      );
      throw error;
    }
  }

  private fallbackEventId(event: TraceEvent): string {
    const logicalEvent = JSON.stringify({
      runId: event.runId,
      workflowId: event.workflowId ?? null,
      organizationId: event.organizationId ?? null,
      nodeRef: event.nodeRef,
      activityId: event.context?.activityId ?? null,
      type: event.type,
      timestamp: event.timestamp,
      level: event.level ?? 'info',
      message: event.message ?? null,
      error: event.error ?? null,
      outputSummary: event.outputSummary ?? null,
      data: event.data ?? null,
    });
    return `trace:${createHash('sha256').update(logicalEvent).digest('hex')}`;
  }

  private fallbackSequence(eventId: string): number {
    return (createHash('sha256').update(eventId).digest().readUInt32BE(0) % 2_147_483_646) + 1;
  }

  private serializeForKafka(payload: SerializedTraceEvent): string {
    const message = JSON.stringify(payload);
    const messageSize = Buffer.byteLength(message, 'utf8');
    if (messageSize <= MAX_KAFKA_MESSAGE_BYTES) {
      return message;
    }

    const truncated: SerializedTraceEvent = {
      ...payload,
      message: this.truncateString(payload.message, TRACE_PREVIEW_CHARS),
      error: this.truncateTraceError(payload.error, TRACE_PREVIEW_CHARS),
      outputSummary: this.truncateValue(payload.outputSummary, TRACE_PREVIEW_CHARS),
      data: {
        _truncated: true,
        _originalSize: messageSize,
        _payload:
          payload.data && '_payload' in payload.data
            ? this.truncateValue(payload.data._payload, TRACE_PREVIEW_CHARS)
            : undefined,
        _metadata:
          payload.data && '_metadata' in payload.data
            ? this.truncateValue(payload.data._metadata, TRACE_PREVIEW_CHARS)
            : undefined,
      },
    };

    const truncatedMessage = JSON.stringify(truncated);
    if (Buffer.byteLength(truncatedMessage, 'utf8') <= MAX_KAFKA_MESSAGE_BYTES) {
      return truncatedMessage;
    }

    return JSON.stringify({
      ...truncated,
      message: this.truncateString(payload.message, TRACE_FINAL_PREVIEW_CHARS),
      error: this.truncateTraceError(payload.error, TRACE_FINAL_PREVIEW_CHARS),
      outputSummary: {
        _truncated: true,
        _originalSize: messageSize,
      },
      data: {
        _truncated: true,
        _originalSize: messageSize,
      },
    });
  }

  private truncateTraceError(
    error: SerializedTraceEvent['error'],
    maxChars: number,
  ): SerializedTraceEvent['error'] {
    if (error === undefined || typeof error === 'string') {
      return this.truncateString(error, maxChars);
    }

    return {
      ...error,
      message: this.truncateString(error.message, maxChars) ?? error.message,
      stack: this.truncateString(error.stack, maxChars),
      details: this.truncateValue(error.details, maxChars) as Record<string, unknown> | undefined,
    };
  }

  private truncateString(value: string | undefined, maxChars: number): string | undefined {
    if (value === undefined || value.length <= maxChars) {
      return value;
    }
    return `${value.slice(0, maxChars)}... (truncated ${value.length - maxChars} chars)`;
  }

  private truncateValue(value: unknown, maxChars: number): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return this.truncateString(value, maxChars);
    }

    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') <= maxChars) {
      return value;
    }

    if (Array.isArray(value)) {
      return {
        _truncated: true,
        _originalType: 'array',
        _itemCount: value.length,
        _preview: value.slice(0, 5).map((item) => this.truncateValue(item, 1_000)),
      };
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      const preview: Record<string, unknown> = {};
      for (const [key, entryValue] of entries.slice(0, 20)) {
        preview[key] = this.truncateValue(entryValue, 1_000);
      }
      return {
        ...preview,
        _truncated: true,
        _originalType: 'object',
        _keyCount: entries.length,
      };
    }

    return value;
  }

  private packData(event: TraceEvent): Record<string, unknown> | null {
    const hasData = event.data && typeof event.data === 'object' && !Array.isArray(event.data);
    const hasMetadata =
      event.context && typeof event.context === 'object' && !Array.isArray(event.context);

    if (!hasData && !hasMetadata) {
      return null;
    }

    const packed: Record<string, unknown> = {};

    if (hasData) {
      packed._payload = { ...(event.data as Record<string, unknown>) };
    }

    if (hasMetadata) {
      packed._metadata = {
        ...(event.context as unknown as Record<string, unknown>),
      };
    }

    return packed;
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
        this.logger.error('[KafkaTraceAdapter] Failed to connect to brokers', error);
        throw error;
      }
      return;
    }
    await this.connectPromise;
  }
}
