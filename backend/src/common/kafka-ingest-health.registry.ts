import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { areIngestServicesEnabled, type IngestConfig } from '../config';
import type { KafkaConsumerHealthReporter } from './kafka-consumer-lifecycle';

export const KAFKA_INGEST_CONSUMERS = ['events', 'agent-trace', 'node-io', 'logs'] as const;

export type KafkaIngestConsumerName = (typeof KAFKA_INGEST_CONSUMERS)[number];
export type KafkaIngestConsumerState =
  | 'disabled'
  | 'starting'
  | 'connecting'
  | 'running'
  | 'failed'
  | 'stopped';

export interface KafkaIngestConsumerHealth {
  required: boolean;
  state: KafkaIngestConsumerState;
  error?: string;
}

@Injectable()
export class KafkaIngestHealthRegistry {
  private readonly consumers = new Map<KafkaIngestConsumerName, KafkaIngestConsumerHealth>();

  constructor(configService: ConfigService) {
    const ingest = configService.get<IngestConfig>('ingest');
    const required = areIngestServicesEnabled(ingest);
    for (const consumer of KAFKA_INGEST_CONSUMERS) {
      this.consumers.set(consumer, {
        required,
        state: required ? 'starting' : 'disabled',
      });
    }
  }

  reporter(name: KafkaIngestConsumerName): KafkaConsumerHealthReporter {
    return {
      connecting: () => this.markConnecting(name),
      running: () => this.markRunning(name),
      failed: (error) => this.markFailed(name, error),
      stopped: () => this.markStopped(name),
    };
  }

  markConnecting(name: KafkaIngestConsumerName): void {
    this.updateRequired(name, { state: 'connecting' });
  }

  markRunning(name: KafkaIngestConsumerName): void {
    this.updateRequired(name, { state: 'running' });
  }

  markFailed(name: KafkaIngestConsumerName, error: unknown): void {
    this.updateRequired(name, {
      state: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  markStopped(name: KafkaIngestConsumerName): void {
    const current = this.consumers.get(name);
    if (!current?.required) {
      return;
    }
    this.consumers.set(name, { required: true, state: 'stopped' });
  }

  snapshot(): Record<KafkaIngestConsumerName, KafkaIngestConsumerHealth> {
    return Object.fromEntries(
      KAFKA_INGEST_CONSUMERS.map((name) => [name, { ...this.consumers.get(name)! }]),
    ) as Record<KafkaIngestConsumerName, KafkaIngestConsumerHealth>;
  }

  allRequiredRunning(): boolean {
    return [...this.consumers.values()].every(
      (consumer) => !consumer.required || consumer.state === 'running',
    );
  }

  private updateRequired(
    name: KafkaIngestConsumerName,
    update: Omit<KafkaIngestConsumerHealth, 'required'>,
  ): void {
    this.consumers.set(name, { required: true, ...update });
  }
}
