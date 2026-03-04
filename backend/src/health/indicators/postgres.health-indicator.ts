import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { Pool } from 'pg';

/**
 * Health indicator that verifies the PostgreSQL connection pool can execute
 * a lightweight query. Uses the `pg` Pool injected via DatabaseModule.
 */
@Injectable()
export class PostgresHealthIndicator extends HealthIndicator {
  constructor(private readonly pool: Pool) {
    super();
  }

  async isHealthy(key = 'postgres'): Promise<HealthIndicatorResult> {
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'PostgreSQL health check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
