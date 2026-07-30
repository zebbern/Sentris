import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import type { AgentTraceEvent, AgentTracePublisher } from '@sentris/component-sdk';
import { ConfigurationError } from '@sentris/component-sdk';
import {
  DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS,
  durableTelemetryKafkaProducerConfig,
} from '@sentris/shared';
import {
  publishWithDurableFallback,
  type DurableKafkaFallback,
} from '../common/durable-kafka-fallback';

export interface KafkaAgentTracePublisherConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  logLevel?: keyof typeof KafkaLogLevel;
}

export class KafkaAgentTracePublisher implements AgentTracePublisher {
  private readonly producer: Producer;
  private connectPromise: Promise<void> | undefined;
  private connected = false;

  constructor(
    private readonly config: KafkaAgentTracePublisherConfig,
    private readonly logger: Pick<Console, 'log' | 'error'> = console,
    private readonly fallback?: DurableKafkaFallback,
  ) {
    if (!config.brokers.length) {
      throw new ConfigurationError('KafkaAgentTracePublisher requires at least one broker', {
        configKey: 'brokers',
        details: { brokers: config.brokers },
      });
    }

    const kafka = new Kafka({
      clientId: config.clientId ?? 'sentris-agent-trace',
      brokers: config.brokers,
      requestTimeout: DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS,
      logLevel: config.logLevel ? KafkaLogLevel[config.logLevel] : KafkaLogLevel.NOTHING,
    });

    this.producer = kafka.producer(durableTelemetryKafkaProducerConfig());
  }

  async publish(event: AgentTraceEvent): Promise<void> {
    const value = JSON.stringify(event);
    try {
      await publishWithDurableFallback({
        publish: async () => {
          await this.ensureConnected();
          await this.producer.send({
            topic: this.config.topic,
            messages: [
              {
                key: event.agentRunId,
                value,
              },
            ],
          });
        },
        fallback: this.fallback,
        publication: {
          topic: this.config.topic,
          key: event.agentRunId,
          value,
          organizationId: event.organizationId ?? null,
        },
        source: 'KafkaAgentTracePublisher',
        logger: this.logger,
      });
    } catch (error: unknown) {
      this.logger.error('[KafkaAgentTracePublisher] Failed to send agent trace event', error);
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
        this.logger.error('[KafkaAgentTracePublisher] Failed to connect to brokers', error);
        throw error;
      }
      return;
    }
    await this.connectPromise;
  }
}
