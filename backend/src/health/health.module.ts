import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@nestjs/config';

import { HealthController, InternalHealthController } from './health.controller';
import {
  PostgresHealthIndicator,
  RedisHealthIndicator,
  TemporalHealthIndicator,
  KafkaIngestHealthIndicator,
} from './indicators';
import { HealthProbeService } from './health-probe.service';
import { KafkaIngestRuntimeModule } from '../common/kafka-ingest-runtime.module';

@Module({
  imports: [TerminusModule, ConfigModule, KafkaIngestRuntimeModule],
  controllers: [HealthController, InternalHealthController],
  providers: [
    HealthProbeService,
    PostgresHealthIndicator,
    RedisHealthIndicator,
    TemporalHealthIndicator,
    KafkaIngestHealthIndicator,
  ],
  exports: [HealthProbeService],
})
export class HealthModule {}
