import { Module } from '@nestjs/common';

import { KafkaIngestHealthRegistry } from './kafka-ingest-health.registry';

@Module({
  providers: [KafkaIngestHealthRegistry],
  exports: [KafkaIngestHealthRegistry],
})
export class KafkaIngestRuntimeModule {}
