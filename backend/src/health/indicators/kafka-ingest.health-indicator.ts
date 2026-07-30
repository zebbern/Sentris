import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';

import { KafkaIngestHealthRegistry } from '../../common/kafka-ingest-health.registry';

@Injectable()
export class KafkaIngestHealthIndicator extends HealthIndicator {
  constructor(private readonly registry: KafkaIngestHealthRegistry) {
    super();
  }

  async isHealthy(key = 'kafkaIngest'): Promise<HealthIndicatorResult> {
    const consumers = this.registry.snapshot();
    const ready = this.registry.allRequiredRunning();
    const status = this.getStatus(key, ready, { consumers });
    if (ready) {
      return status;
    }

    throw new HealthCheckError('Required Kafka ingest consumers are not running', status);
  }
}
