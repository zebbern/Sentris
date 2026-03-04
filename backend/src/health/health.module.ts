import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@nestjs/config';

import { HealthController } from './health.controller';
import {
  PostgresHealthIndicator,
  RedisHealthIndicator,
  TemporalHealthIndicator,
} from './indicators';

@Module({
  imports: [TerminusModule, ConfigModule],
  controllers: [HealthController],
  providers: [PostgresHealthIndicator, RedisHealthIndicator, TemporalHealthIndicator],
})
export class HealthModule {}
