import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import type { ITraceService, TraceEvent } from '@sentris/component-sdk';
import { ConfigurationError, MAX_KAFKA_MESSAGE_BYTES } from '@sentris/component-sdk';

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
  runId: string;
  workflowId?: string;
  organizationId?: string | null;
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
  private readonly connectPromise: Promise<void>;
  private readonly sequenceByRun = new Map<string, number>();
  private readonly metadataByRun = new Map<string, RunMetadata>();

  constructor(
    private readonly config: KafkaTraceAdapterConfig,
    private readonly logger: Pick<Console, 'log' | 'error'> = console,
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
      logLevel: config.logLevel ? KafkaLogLevel[config.logLevel] : KafkaLogLevel.NOTHING,
    });

    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
    });

    this.connectPromise = this.producer.connect().catch((error: unknown) => {
      this.logger.error('[KafkaTraceAdapter] Failed to connect to brokers', error);
      throw error;
    });
  }

  setRunMetadata(runId: string, metadata: RunMetadata): void {
    this.metadataByRun.set(runId, metadata);
  }

  finalizeRun(runId: string): void {
    this.metadataByRun.delete(runId);
    this.sequenceByRun.delete(runId);
  }

  record(event: TraceEvent): void {
    const sequence = this.nextSequence(event.runId);
    const metadata = this.metadataByRun.get(event.runId);

    const payload: SerializedTraceEvent = {
      runId: event.runId,
      workflowId: metadata?.workflowId,
      organizationId: metadata?.organizationId ?? null,
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

    void this.connectPromise
      .then(() =>
        this.producer.send({
          topic: this.config.topic,
          messages: [
            {
              value: message,
            },
          ],
        }),
      )
      .catch((error: unknown) => {
        this.logger.error(
          '[KafkaTraceAdapter] CRITICAL: Failed to send trace event — messages may be lost. Check Kafka broker connectivity and topic configuration.',
          error,
        );
      });
  }

  private nextSequence(runId: string): number {
    const current = this.sequenceByRun.get(runId) ?? 0;
    const next = current + 1;
    this.sequenceByRun.set(runId, next);
    return next;
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
}
