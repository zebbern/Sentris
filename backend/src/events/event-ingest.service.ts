import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka } from 'kafkajs';
import { z } from 'zod';
import { KafkaTopicResolver } from '../common/kafka-topic-resolver';
import { runRetriableKafkaIngest } from '../common/kafka-retriable-ingest-error';
import { KafkaConsumerLifecycleSupervisor } from '../common/kafka-consumer-lifecycle';
import { KafkaIngestHealthRegistry } from '../common/kafka-ingest-health.registry';
import { recordEmptyRequiredKafkaPayload } from '../common/empty-kafka-payload';
import { REQUIRED_KAFKA_CONSUMER_TIMING } from '../common/kafka-consumer-timing';

import { TraceRepository, type PersistedTraceEvent } from '../trace/trace.repository';
import { areIngestServicesEnabled, type IngestConfig, type KafkaConfig } from '../config';
import { OutboxRepository, type KafkaMessageIdentity } from '../outbox/outbox.repository';

const KafkaTraceEventPayloadSchema = z.object({
  eventId: z.string().min(1).max(400),
  runId: z.string().min(1),
  workflowId: z.string().min(1).nullable().optional(),
  organizationId: z.string().max(191).nullable().optional(),
  type: z.enum([
    'NODE_STARTED',
    'NODE_COMPLETED',
    'NODE_FAILED',
    'NODE_PROGRESS',
    'AWAITING_INPUT',
    'NODE_SKIPPED',
    'HTTP_REQUEST_SENT',
    'HTTP_RESPONSE_RECEIVED',
    'HTTP_REQUEST_ERROR',
  ]),
  nodeRef: z.string().min(1),
  timestamp: z.string().datetime(),
  level: z.string().min(1),
  message: z.string().optional(),
  error: z.unknown().optional(),
  outputSummary: z.unknown().optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  sequence: z.number().int().min(1),
});

type KafkaTraceEventPayload = z.infer<typeof KafkaTraceEventPayloadSchema>;

@Injectable()
export class EventIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventIngestService.name);
  private readonly kafkaBrokers!: string[];
  private readonly kafkaTopic!: string;
  private readonly kafkaGroupId!: string;
  private readonly kafkaClientId!: string;
  private readonly consumerLifecycle?: KafkaConsumerLifecycleSupervisor;

  constructor(
    private readonly traceRepository: TraceRepository,
    private readonly configService: ConfigService,
    private readonly outboxRepository: OutboxRepository,
    @Optional() healthRegistry?: KafkaIngestHealthRegistry,
  ) {
    const ingest = this.configService.get<IngestConfig>('ingest');
    if (!areIngestServicesEnabled(ingest)) {
      return;
    }

    const kafka = this.configService.get<KafkaConfig>('kafka')!;
    const brokerEnv = kafka.brokers;
    this.kafkaBrokers = brokerEnv
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (this.kafkaBrokers.length === 0) {
      throw new Error('LOG_KAFKA_BROKERS must be configured for event ingestion');
    }

    // Use instance-aware topic name
    const topicResolver = new KafkaTopicResolver({
      instanceId: kafka.instanceId,
      topics: { events: kafka.eventTopic },
    });
    this.kafkaTopic = topicResolver.getEventsTopic();

    const instanceSuffix = kafka.instanceId ? `-${kafka.instanceId}` : '';
    this.kafkaGroupId = kafka.eventGroupId ?? `sentris-event-ingestor${instanceSuffix}`;
    this.kafkaClientId = kafka.eventClientId ?? `sentris-backend-events${instanceSuffix}`;
    this.consumerLifecycle = new KafkaConsumerLifecycleSupervisor({
      name: 'event ingest',
      createConsumer: () => this.createConsumer(),
      startConsumer: (consumer) => this.startConsumer(consumer),
      health: healthRegistry?.reporter('events'),
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
          `Trace ingest failed for ${topic}[${partition}]@${message.offset}`,
          () => this.processKafkaMessage(message.value, identity),
        );
      },
    });
    this.logger.log(
      `Kafka event ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumerLifecycle?.stop();
  }

  private async processKafkaMessage(
    value: Buffer | null,
    identity: KafkaMessageIdentity,
  ): Promise<void> {
    if (value === null) {
      await recordEmptyRequiredKafkaPayload(this.outboxRepository, identity);
      this.logger.error(
        `Discarding empty trace event from Kafka (topic=${identity.topic}, partition=${identity.partition}, offset=${identity.offset})`,
      );
      return;
    }

    let payload: KafkaTraceEventPayload;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.toString());
      payload = KafkaTraceEventPayloadSchema.parse(parsed);
    } catch (error: unknown) {
      await this.outboxRepository.recordKafkaPoisonMessage(
        identity,
        value,
        error,
        this.organizationIdFromParsed(parsed),
      );
      this.logger.error(
        `Discarding malformed trace event from Kafka (topic=${identity.topic}, partition=${identity.partition}, offset=${identity.offset})`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }

    this.logger.debug(
      `Processing trace event: runId=${payload.runId}, type=${payload.type}, sequence=${payload.sequence}, offset=${identity.offset}`,
    );
    await this.persistEvent(payload, identity);
    this.logger.debug(
      `Successfully persisted trace event for run ${payload.runId}, sequence ${payload.sequence}`,
    );
  }

  private async persistEvent(
    event: KafkaTraceEventPayload,
    identity: KafkaMessageIdentity,
  ): Promise<void> {
    const mapped: PersistedTraceEvent = {
      runId: event.runId,
      workflowId: event.workflowId,
      organizationId: event.organizationId ?? null,
      type: event.type,
      nodeRef: event.nodeRef,
      timestamp: event.timestamp,
      sequence: event.sequence,
      level: event.level,
      message: event.message,
      error: event.error,
      outputSummary: event.outputSummary,
      data: event.data ?? null,
    };

    const inserted = await this.outboxRepository.runKafkaEventOnce(
      identity,
      event.eventId,
      event.organizationId ?? null,
      (executor) => this.traceRepository.appendWithExecutor(executor, mapped),
    );
    if (inserted) {
      await this.traceRepository.notifyAppended(mapped);
    }
  }

  private organizationIdFromParsed(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const organizationId = (value as Record<string, unknown>).organizationId;
    return typeof organizationId === 'string' && organizationId.length <= 191
      ? organizationId
      : null;
  }
}
