import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import {
  DURABLE_KAFKA_PUBLISH_EVENT,
  DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS,
  durableTelemetryKafkaProducerConfig,
  type DurableKafkaPublishPayload,
} from '@sentris/shared';
import { z } from 'zod';

import { areIngestServicesEnabled, type IngestConfig, type KafkaConfig } from '../config';
import { KafkaTopicResolver } from '../common/kafka-topic-resolver';

const DurableKafkaPublishPayloadSchema = z.object({
  topic: z.string().min(1).max(249),
  key: z.string().nullable(),
  value: z.string(),
});

@Injectable()
export class TelemetryKafkaReplayListener implements OnModuleDestroy {
  private readonly logger = new Logger(TelemetryKafkaReplayListener.name);
  private readonly producer: Producer | undefined;
  private readonly allowedTopics: ReadonlySet<string>;
  private connectPromise: Promise<void> | undefined;
  private connected = false;

  constructor(configService: ConfigService) {
    const config = configService.get<KafkaConfig>('kafka')!;
    const brokers = config.brokers
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    const ingest = configService.get<IngestConfig>('ingest');
    if (brokers.length === 0 && areIngestServicesEnabled(ingest)) {
      throw new Error('LOG_KAFKA_BROKERS must be configured for telemetry outbox replay');
    }

    const topics = new KafkaTopicResolver({
      instanceId: config.instanceId,
      topics: {
        logs: config.logTopic,
        events: config.eventTopic,
        agentTrace: config.agentTraceTopic,
        nodeIo: config.nodeIoTopic,
      },
    });
    this.allowedTopics = new Set([
      topics.getLogsTopic(),
      topics.getEventsTopic(),
      topics.getAgentTraceTopic(),
      topics.getNodeIOTopic(),
    ]);
    this.producer =
      brokers.length > 0
        ? new Kafka({
            clientId: config.instanceId
              ? `sentris-backend-telemetry-replay-${config.instanceId}`
              : 'sentris-backend-telemetry-replay',
            brokers,
            requestTimeout: DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS,
            logLevel: KafkaLogLevel.NOTHING,
          }).producer(durableTelemetryKafkaProducerConfig())
        : undefined;
  }

  @OnEvent(DURABLE_KAFKA_PUBLISH_EVENT, { async: true })
  async republish(rawPayload: unknown): Promise<void> {
    const payload: DurableKafkaPublishPayload = DurableKafkaPublishPayloadSchema.parse(rawPayload);
    if (!this.allowedTopics.has(payload.topic)) {
      throw new Error(
        `Durable telemetry replay target "${payload.topic}" is not an allowed telemetry topic`,
      );
    }

    const producer = await this.ensureConnected();
    await producer.send({
      topic: payload.topic,
      messages: [{ key: payload.key, value: payload.value }],
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.producer || (!this.connected && !this.connectPromise)) return;
    await this.connectPromise?.catch(() => undefined);
    await this.producer.disconnect();
    this.connected = false;
    this.connectPromise = undefined;
  }

  private async ensureConnected(): Promise<Producer> {
    if (!this.producer) {
      throw new Error(
        'Durable telemetry replay is unavailable while ingest services are disabled; the outbox event remains retryable',
      );
    }
    if (this.connected) return this.producer;
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
        this.logger.error(
          'Failed to connect the durable telemetry replay producer',
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      }
      return this.producer;
    }
    await this.connectPromise;
    return this.producer;
  }
}
