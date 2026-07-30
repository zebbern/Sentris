import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer } from 'kafkajs';
import { z } from 'zod';
import { KafkaTopicResolver } from '../common/kafka-topic-resolver';
import { runRetriableKafkaIngest } from '../common/kafka-retriable-ingest-error';
import { KafkaConsumerLifecycleSupervisor } from '../common/kafka-consumer-lifecycle';
import { KafkaIngestHealthRegistry } from '../common/kafka-ingest-health.registry';
import { recordEmptyRequiredKafkaPayload } from '../common/empty-kafka-payload';
import { REQUIRED_KAFKA_CONSUMER_TIMING } from '../common/kafka-consumer-timing';

import { LogStreamRepository } from '../trace/log-stream.repository';
import type { KafkaLogEntry } from './log-entry.types';
import { LokiLogClient } from './loki.client';
import { redactSensitiveData } from './redact-sensitive';
import {
  areIngestServicesEnabled,
  type IngestConfig,
  type KafkaConfig,
  type LokiConfig,
} from '../config';
import { OutboxRepository, type KafkaMessageIdentity } from '../outbox/outbox.repository';

const KafkaLogEntrySchema = z.object({
  eventId: z.string().min(1).max(400).optional(),
  runId: z.string().min(1),
  nodeRef: z.string().min(1),
  stream: z.enum(['stdout', 'stderr', 'console']),
  message: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  timestamp: z.string().datetime().optional(),
  metadata: z
    .object({
      activityId: z.string().optional(),
      attempt: z.number().optional(),
      correlationId: z.string().optional(),
      streamId: z.string().optional(),
      joinStrategy: z.enum(['all', 'any', 'first']).optional(),
      triggeredBy: z.string().optional(),
      failure: z
        .object({
          at: z.string(),
          reason: z.object({
            message: z.string(),
            name: z.string().optional(),
          }),
        })
        .optional(),
    })
    .optional(),
  organizationId: z.string().max(191).nullable().optional(),
});

@Injectable()
export class LogIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LogIngestService.name);
  private readonly kafkaBrokers!: string[];
  private readonly kafkaTopic!: string;
  private readonly kafkaGroupId!: string;
  private readonly kafkaClientId!: string;
  private readonly lokiClient!: LokiLogClient;
  private readonly consumerLifecycle?: KafkaConsumerLifecycleSupervisor;

  constructor(
    private readonly repository: LogStreamRepository,
    private readonly configService: ConfigService,
    private readonly outboxRepository: OutboxRepository,
    @Optional() healthRegistry?: KafkaIngestHealthRegistry,
  ) {
    const ingest = this.configService.get<IngestConfig>('ingest');
    if (!areIngestServicesEnabled(ingest)) {
      return;
    }

    const kafka = this.configService.get<KafkaConfig>('kafka')!;
    const loki = this.configService.get<LokiConfig>('loki')!;
    const brokerEnv = kafka.brokers;
    this.kafkaBrokers = brokerEnv
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (this.kafkaBrokers.length === 0) {
      throw new Error('LOG_KAFKA_BROKERS must be configured for Kafka log ingestion');
    }

    // Use instance-aware topic name
    const topicResolver = new KafkaTopicResolver({
      instanceId: kafka.instanceId,
      topics: { logs: kafka.logTopic },
    });
    this.kafkaTopic = topicResolver.getLogsTopic();

    const instanceSuffix = kafka.instanceId ? `-${kafka.instanceId}` : '';
    this.kafkaGroupId = kafka.logGroupId ?? `sentris-log-ingestor${instanceSuffix}`;
    this.kafkaClientId = kafka.logClientId ?? `sentris-backend${instanceSuffix}`;

    const lokiUrl = loki.url;
    if (!lokiUrl) {
      throw new Error('LOKI_URL must be configured for Kafka log ingestion');
    }
    this.lokiClient = new LokiLogClient({
      baseUrl: lokiUrl,
      tenantId: loki.tenantId,
      username: loki.username,
      password: loki.password,
      timeoutMs: loki.pushTimeoutMs,
    });
    this.consumerLifecycle = new KafkaConsumerLifecycleSupervisor({
      name: 'log ingest',
      createConsumer: () => this.createConsumer(),
      startConsumer: (consumer) => this.startConsumer(consumer),
      health: healthRegistry?.reporter('logs'),
      logger: this.logger,
    });
  }

  onModuleInit(): void {
    this.consumerLifecycle?.start();
  }

  private createConsumer(): Consumer {
    const kafka = new Kafka({
      clientId: this.kafkaClientId,
      brokers: this.kafkaBrokers,
      requestTimeout: 30000,
      retry: {
        retries: 10,
        initialRetryTime: 100,
        maxRetryTime: 30000,
        restartOnFailure: async () => false,
      },
    });
    return kafka.consumer({
      groupId: this.kafkaGroupId,
      ...REQUIRED_KAFKA_CONSUMER_TIMING,
    });
  }

  private async startConsumer(consumer: Consumer): Promise<void> {
    await consumer.connect();
    await consumer.subscribe({ topic: this.kafkaTopic, fromBeginning: true });
    await consumer.run({
      eachMessage: async ({ message, topic, partition }) => {
        const identity = { topic, partition, offset: message.offset };
        await runRetriableKafkaIngest(
          `Log ingest failed for ${topic}[${partition}]@${message.offset}`,
          () => this.processKafkaMessage(message.value, identity, message.timestamp),
        );
      },
    });
    this.logger.log(
      `Kafka log ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumerLifecycle?.stop();
  }

  private async processKafkaMessage(
    value: Buffer | null,
    identity: KafkaMessageIdentity,
    kafkaTimestamp?: string,
  ): Promise<void> {
    if (value === null) {
      await recordEmptyRequiredKafkaPayload(this.outboxRepository, identity);
      this.logger.error(
        `Discarding empty log entry from Kafka (topic=${identity.topic}, partition=${identity.partition}, offset=${identity.offset})`,
      );
      return;
    }

    let entry: KafkaLogEntry;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.toString());
      entry = KafkaLogEntrySchema.parse(parsed);
    } catch (error: unknown) {
      await this.outboxRepository.recordKafkaPoisonMessage(
        identity,
        value,
        error,
        this.organizationIdFromParsed(parsed),
      );
      this.logger.error(
        `Discarding malformed log entry from Kafka (topic=${identity.topic}, partition=${identity.partition}, offset=${identity.offset})`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }

    await this.processEntry(entry, identity, kafkaTimestamp);
  }

  private async processEntry(
    entry: KafkaLogEntry,
    identity: KafkaMessageIdentity,
    kafkaTimestamp?: string,
  ): Promise<void> {
    const alreadyProcessed = entry.eventId
      ? await this.outboxRepository.hasKafkaEventReceipt(entry.eventId)
      : await this.outboxRepository.hasKafkaMessageReceipt(identity);
    if (alreadyProcessed) {
      return;
    }

    const sanitizedMessage = redactSensitiveData(entry.message ?? '');
    if (!sanitizedMessage || sanitizedMessage.trim().length === 0) {
      return;
    }

    const brokerTimestamp = kafkaTimestamp ? Number(kafkaTimestamp) : Number.NaN;
    const timestamp = entry.timestamp
      ? new Date(entry.timestamp)
      : Number.isFinite(brokerTimestamp)
        ? new Date(brokerTimestamp)
        : new Date(0);
    const labels = this.buildLabels(entry);
    const lines = this.buildLines(sanitizedMessage, timestamp);
    if (!lines.length) {
      return;
    }

    // Loki ignores exact duplicate entries with the same stream labels,
    // nanosecond timestamp, and line. This makes a retry after an ambiguous
    // Loki success safe while the database receipt remains authoritative.
    await this.lokiClient.push(labels, lines);
    const project = (executor: Parameters<LogStreamRepository['upsertMetadataWithExecutor']>[0]) =>
      this.repository.upsertMetadataWithExecutor(executor, {
        runId: entry.runId,
        nodeRef: entry.nodeRef,
        stream: entry.stream,
        labels,
        firstTimestamp: lines[0].timestamp,
        lastTimestamp: lines[lines.length - 1].timestamp,
        lineCount: lines.length,
        organizationId: entry.organizationId ?? null,
      });
    if (entry.eventId) {
      await this.outboxRepository.runKafkaEventOnce(
        identity,
        entry.eventId,
        entry.organizationId ?? null,
        project,
      );
      return;
    }
    await this.outboxRepository.runKafkaMessageOnce(
      identity,
      entry.organizationId ?? null,
      project,
    );
  }

  private buildLabels(entry: KafkaLogEntry): Record<string, string> {
    const labels: Record<string, string> = {
      run_id: entry.runId,
      node: entry.nodeRef,
      stream: entry.stream,
    };

    if (entry.level) {
      labels.level = entry.level;
    }

    const metadata = entry.metadata;
    if (metadata?.activityId) {
      labels.activity_id = metadata.activityId;
    }
    if (metadata?.attempt !== undefined) {
      labels.attempt = String(metadata.attempt);
    }
    if (metadata?.correlationId) {
      labels.correlation_id = metadata.correlationId;
    }
    if (metadata?.streamId) {
      labels.stream_id = metadata.streamId;
    }
    if (metadata?.joinStrategy) {
      labels.join_strategy = metadata.joinStrategy;
    }
    if (metadata?.triggeredBy) {
      labels.triggered_by = metadata.triggeredBy;
    }

    return labels;
  }

  private buildLines(message: string, timestamp: Date) {
    const normalized = message.replace(/\r/g, '').trim();
    if (!normalized) {
      return [];
    }

    return [
      {
        message: normalized,
        timestamp,
      },
    ];
  }

  private organizationIdFromParsed(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const organizationId = (value as Record<string, unknown>).organizationId;
    return typeof organizationId === 'string' && organizationId.length <= 191
      ? organizationId
      : null;
  }
}
