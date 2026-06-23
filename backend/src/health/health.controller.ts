import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, type HealthCheckResult } from '@nestjs/terminus';

import { Public } from '../auth/public.decorator';
import { HealthProbeService } from './health-probe.service';

@Controller('health')
export class HealthController {
  constructor(private readonly probes: HealthProbeService) {}

  /**
   * Liveness probe — returns 200 when the process is running.
   * Used by Docker HEALTHCHECK / Kubernetes livenessProbe.
   */
  @Public()
  @SkipThrottle()
  @Get()
  liveness(): { status: string; service: string; timestamp: string } {
    return this.probes.liveness();
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
    return this.probes.readiness();
  }
}
