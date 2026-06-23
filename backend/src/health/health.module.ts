import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@nestjs/config';

import { HealthController } from './health.controller';
import {
  PostgresHealthIndicator,
  RedisHealthIndicator,
  TemporalHealthIndicator,
} from './indicators';
import { HealthProbeService } from './health-probe.service';

@Module({
  imports: [TerminusModule, ConfigModule],
  controllers: [HealthController],
  providers: [
    HealthProbeService,
    PostgresHealthIndicator,
    RedisHealthIndicator,
    TemporalHealthIndicator,
  ],
  exports: [HealthProbeService],
})
export class HealthModule {}
