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

import { AgentTraceRepository, type AgentTraceEventInput } from './agent-trace.repository';
import { AgentConversationRepository } from './agent-conversation.repository';
import { areIngestServicesEnabled, type IngestConfig, type KafkaConfig } from '../config';
import { OutboxRepository, type KafkaMessageIdentity } from '../outbox/outbox.repository';

const AgentTraceEventSchema = z.object({
  eventId: z.string().min(1).max(400),
  agentRunId: z.string().min(1),
  workflowRunId: z.string().min(1),
  workflowId: z.string().min(1).nullable().optional(),
  organizationId: z.string().max(191).nullable().optional(),
  nodeRef: z.string().min(1),
  sequence: z.number().int().positive(),
  timestamp: z.string().datetime(),
  part: z.record(z.string(), z.unknown()),
});

@Injectable()
export class AgentTraceIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentTraceIngestService.name);
  private readonly kafkaBrokers!: string[];
  private readonly kafkaTopic!: string;
  private readonly kafkaGroupId!: string;
  private readonly kafkaClientId!: string;
  private readonly consumerLifecycle?: KafkaConsumerLifecycleSupervisor;

  constructor(
    private readonly repository: AgentTraceRepository,
    private readonly conversations: AgentConversationRepository,
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
      throw new Error('LOG_KAFKA_BROKERS must be configured for agent trace ingestion');
    }

    // Use instance-aware topic name
    const topicResolver = new KafkaTopicResolver({
      instanceId: kafka.instanceId,
      topics: { agentTrace: kafka.agentTraceTopic },
    });
    this.kafkaTopic = topicResolver.getAgentTraceTopic();
    const instanceId = kafka.instanceId;
    const defaultGroupId = instanceId
      ? `sentris-agent-trace-ingestor-${instanceId}`
      : 'sentris-agent-trace-ingestor';
    const defaultClientId = instanceId
      ? `sentris-backend-agent-trace-${instanceId}`
      : 'sentris-backend-agent-trace';

    this.kafkaGroupId = kafka.agentTraceGroupId ?? defaultGroupId;
    this.kafkaClientId = kafka.agentTraceClientId ?? defaultClientId;
    this.consumerLifecycle = new KafkaConsumerLifecycleSupervisor({
      name: 'agent trace ingest',
      createConsumer: () => this.createConsumer(),
      startConsumer: (consumer) => this.startConsumer(consumer),
      health: healthRegistry?.reporter('agent-trace'),
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
          `Agent trace ingest failed for ${topic}[${partition}]@${message.offset}`,
          () => this.processKafkaMessage(message.value, identity),
        );
      },
    });
    this.logger.log(
      `Kafka agent trace ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
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
        `Discarding empty agent trace event from Kafka (topic=${identity.topic}, partition=${identity.partition}, offset=${identity.offset})`,
      );
      return;
    }

    let payload: AgentTraceEventInput;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.toString());
      payload = AgentTraceEventSchema.parse(parsed);
    } catch (error: unknown) {
      await this.outboxRepository.recordKafkaPoisonMessage(identity, value, error, null);
      this.logger.error(
        `Discarding malformed agent trace event from Kafka (topic=${identity.topic}, partition=${identity.partition}, offset=${identity.offset})`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }

    await this.outboxRepository.runKafkaEventOnce(
      identity,
      payload.eventId,
      payload.organizationId ?? null,
      async (executor) => {
        await this.repository.appendWithExecutor(executor, payload);
        if (payload.part.type === 'finish') {
          const failed = payload.part.finishReason === 'error';
          await this.conversations.markTerminalWithExecutor(executor, {
            agentRunId: payload.agentRunId,
            status: failed ? 'failed' : 'completed',
            responseText:
              typeof payload.part.responseText === 'string' ? payload.part.responseText : undefined,
            error:
              failed && typeof payload.part.responseText === 'string'
                ? payload.part.responseText
                : undefined,
            completedAt: new Date(payload.timestamp),
          });
        }
      },
    );
  }
}
