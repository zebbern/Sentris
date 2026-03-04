import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import Redis from 'ioredis';

/**
 * Health indicator that pings Redis. Creates its own lightweight connection
 * (separate from the throttler connection) to avoid coupling to other modules.
 *
 * If REDIS_URL is not configured the check reports as healthy with a
 * "not configured" note — Redis is optional for the platform.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);
  private readonly redisUrl: string | undefined;
  private redis: Redis | null = null;

  constructor(private readonly configService: ConfigService) {
    super();
    this.redisUrl = this.configService.get<string>('redis.url');
  }

  async isHealthy(key = 'redis'): Promise<HealthIndicatorResult> {
    if (!this.redisUrl) {
      return this.getStatus(key, true, { message: 'not configured' });
    }

    try {
      const redis = this.getOrCreateClient();
      const result = await redis.ping();
      if (result !== 'PONG') {
        throw new Error(`Unexpected PING response: ${result}`);
      }
      return this.getStatus(key, true);
    } catch (error) {
      // Discard broken connection so the next check creates a fresh one
      this.destroyClient();
      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  /** Lazily create (or reuse) a lightweight Redis connection for health pings. */
  private getOrCreateClient(): Redis {
    if (!this.redis) {
      this.redis = new Redis(this.redisUrl!, {
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        lazyConnect: true,
        enableReadyCheck: false,
      });
      this.redis.on('error', (err) => {
        this.logger.warn(`Redis health-check client error: ${err.message}`);
      });
    }
    return this.redis;
  }

  private destroyClient(): void {
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }
  }
}
