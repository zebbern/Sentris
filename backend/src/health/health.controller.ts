import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { Public } from '../auth/public.decorator';
import { PostgresHealthIndicator } from './indicators/postgres.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';
import { TemporalHealthIndicator } from './indicators/temporal.health-indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: PostgresHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly temporal: TemporalHealthIndicator,
  ) {}

  /**
   * Liveness probe — returns 200 when the process is running.
   * Used by Docker HEALTHCHECK / Kubernetes livenessProbe.
   */
  @Public()
  @SkipThrottle()
  @Get()
  liveness(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'sentris-backend',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness probe — checks all downstream dependencies.
   * Used by Kubernetes readinessProbe / load-balancer health checks.
   * Returns 503 if any critical dependency is unreachable.
   */
  @Public()
  @SkipThrottle()
  @Get('ready')
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.postgres.isHealthy(),
      () => this.redis.isHealthy(),
      () => this.temporal.isHealthy(),
    ]);
  }
}
