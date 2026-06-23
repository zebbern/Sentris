import { Injectable } from '@nestjs/common';
import { HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { PostgresHealthIndicator } from './indicators/postgres.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';
import { TemporalHealthIndicator } from './indicators/temporal.health-indicator';

@Injectable()
export class HealthProbeService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: PostgresHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly temporal: TemporalHealthIndicator,
  ) {}

  liveness(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'sentris-backend',
      timestamp: new Date().toISOString(),
    };
  }

  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.postgres.isHealthy(),
      () => this.redis.isHealthy(),
      () => this.temporal.isHealthy(),
    ]);
  }
}
