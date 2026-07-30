import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka } from 'kafkajs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { KafkaTopicResolver } from '../common/kafka-topic-resolver';
import { runRetriableKafkaIngest } from '../common/kafka-retriable-ingest-error';
import { KafkaConsumerLifecycleSupervisor } from '../common/kafka-consumer-lifecycle';
import { KafkaIngestHealthRegistry } from '../common/kafka-ingest-health.registry';
import { recordEmptyRequiredKafkaPayload } from '../common/empty-kafka-payload';
import { REQUIRED_KAFKA_CONSUMER_TIMING } from '../common/kafka-consumer-timing';

import { RECON_COMPONENT_IDS } from '../assets/asset-extractor';
import { NodeIORepository, type NodeIOTransactionExecutor } from './node-io.repository';
import { areIngestServicesEnabled, type IngestConfig, type KafkaConfig } from '../config';
import { OutboxRepository, type KafkaMessageIdentity } from '../outbox/outbox.repository';

const NodeIoBaseEventSchema = z.object({
  eventId: z.string().min(1).max(400).optional(),
  runId: z.string().min(1),
  nodeRef: z.string().min(1),
  workflowId: z.string().optional(),
  organizationId: z.string().max(191).nullable().optional(),
  componentId: z.string().optional(),
  timestamp: z.string().datetime(),
});

const SerializedNodeIOEventSchema = z.discriminatedUnion('type', [
  NodeIoBaseEventSchema.extend({
    type: z.literal('NODE_IO_START'),
    componentId: z.string().min(1),
    inputs: z.record(z.string(), z.unknown()).optional(),
    inputsSize: z.number().int().nonnegative().optional(),
    inputsSpilled: z.boolean().optional(),
    inputsStorageRef: z.string().nullable().optional(),
  }),
  NodeIoBaseEventSchema.extend({
    type: z.literal('NODE_IO_COMPLETION'),
    outputs: z.record(z.string(), z.unknown()).optional(),
    outputsSize: z.number().int().nonnegative().optional(),
    outputsSpilled: z.boolean().optional(),
    outputsStorageRef: z.string().nullable().optional(),
    status: z.enum(['completed', 'failed', 'skipped']).optional(),
    errorMessage: z.string().optional(),
  }),
]);

type SerializedNodeIOEvent = z.infer<typeof SerializedNodeIOEventSchema>;

@Injectable()
export class NodeIOIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodeIOIngestService.name);
  private readonly kafkaBrokers!: string[];
  private readonly kafkaTopic!: string;
  private readonly kafkaGroupId!: string;
  private readonly kafkaClientId!: string;
  private readonly consumerLifecycle?: KafkaConsumerLifecycleSupervisor;

  constructor(
    private readonly nodeIORepository: NodeIORepository,
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
      throw new Error('LOG_KAFKA_BROKERS must be configured for node I/O ingestion');
    }

    // Use instance-aware topic name
    const topicResolver = new KafkaTopicResolver({
      instanceId: kafka.instanceId,
      topics: { nodeIo: kafka.nodeIoTopic },
    });
    this.kafkaTopic = topicResolver.getNodeIOTopic();
    const instanceId = kafka.instanceId;
    const defaultGroupId = instanceId
      ? `sentris-node-io-ingestor-${instanceId}`
      : 'sentris-node-io-ingestor';
    const defaultClientId = instanceId
      ? `sentris-backend-node-io-${instanceId}`
      : 'sentris-backend-node-io';

    this.kafkaGroupId = kafka.nodeIoGroupId ?? defaultGroupId;
    this.kafkaClientId = kafka.nodeIoClientId ?? defaultClientId;
    this.consumerLifecycle = new KafkaConsumerLifecycleSupervisor({
      name: 'node I/O ingest',
      createConsumer: () => this.createConsumer(),
      startConsumer: (consumer) => this.startConsumer(consumer),
      health: healthRegistry?.reporter('node-io'),
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
          `Node I/O ingest failed for ${topic}[${partition}]@${message.offset}`,
          () => this.processKafkaMessage(message.value, identity),
        );
      },
    });
    this.logger.log(
      `Kafka node I/O ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumerLifecycle?.stop();
  }

  private async processKafkaMessage(
    value: Buffer | null,
    context: KafkaMessageIdentity,
  ): Promise<void> {
    if (value === null) {
      await recordEmptyRequiredKafkaPayload(this.outboxRepository, context);
      this.logger.error(
        `Discarding empty node I/O event from Kafka (topic=${context.topic}, partition=${context.partition}, offset=${context.offset})`,
      );
      return;
    }

    let payload: SerializedNodeIOEvent;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.toString());
      payload = SerializedNodeIOEventSchema.parse(parsed);
    } catch (error: unknown) {
      await this.outboxRepository.recordKafkaPoisonMessage(
        context,
        value,
        error,
        this.organizationIdFromParsed(parsed),
      );
      this.logger.error(
        `Discarding malformed node I/O event from Kafka (topic=${context.topic}, partition=${context.partition}, offset=${context.offset})`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }

    this.logger.debug(
      `Processing node I/O event: runId=${payload.runId}, nodeRef=${payload.nodeRef}, type=${payload.type}, offset=${context.offset}`,
    );
    await this.persistEvent(payload, context);
  }

  private async persistEvent(
    event: SerializedNodeIOEvent,
    identity: KafkaMessageIdentity,
  ): Promise<void> {
    const eventId = event.eventId ?? this.legacyEventId(event);
    await this.outboxRepository.runKafkaEventOnce(
      identity,
      eventId,
      event.organizationId ?? null,
      async (executor) => {
        if (event.type === 'NODE_IO_START') {
          await this.nodeIORepository.recordStartWithExecutor(executor, {
            runId: event.runId,
            nodeRef: event.nodeRef,
            workflowId: event.workflowId,
            organizationId: event.organizationId,
            componentId: event.componentId || 'unknown',
            inputs: event.inputs || {},
            inputsSize: event.inputsSize,
            inputsSpilled: event.inputsSpilled,
            inputsStorageRef: event.inputsStorageRef,
            startedAt: new Date(event.timestamp),
          });
          return;
        }

        await this.nodeIORepository.recordCompletionWithExecutor(
          executor as NodeIOTransactionExecutor,
          {
            runId: event.runId,
            nodeRef: event.nodeRef,
            componentId: event.componentId,
            organizationId: event.organizationId,
            outputs: event.outputs || {},
            status: event.status || 'completed',
            errorMessage: event.errorMessage,
            outputsSize: event.outputsSize,
            outputsSpilled: event.outputsSpilled,
            outputsStorageRef: event.outputsStorageRef,
            completedAt: new Date(event.timestamp),
            completionEventId: eventId,
            projectAssets: event.componentId ? RECON_COMPONENT_IDS.has(event.componentId) : true,
          },
        );
      },
    );
  }

  private legacyEventId(event: SerializedNodeIOEvent): string {
    return `node-io:${createHash('sha256').update(JSON.stringify(event)).digest('hex')}`;
  }

  private organizationIdFromParsed(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const organizationId = (value as Record<string, unknown>).organizationId;
    return typeof organizationId === 'string' && organizationId.length <= 191
      ? organizationId
      : null;
  }
}
