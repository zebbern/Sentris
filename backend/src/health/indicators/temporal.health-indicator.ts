import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { Connection } from '@temporalio/client';
import type { TemporalTaskConfig } from '../../config';

/**
 * Health indicator that verifies the Temporal server is reachable by calling
 * `describeNamespace` — aligned with the existing check in TemporalService.
 *
 * Uses a short-lived connection to avoid interfering with the main client
 * lifecycle managed by TemporalService.
 */
@Injectable()
export class TemporalHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(TemporalHealthIndicator.name);
  private readonly address: string;
  private readonly namespace: string;

  constructor(private readonly configService: ConfigService) {
    super();
    const cfg = this.configService.get<TemporalTaskConfig>('temporalTask')!;
    this.address = cfg.address;
    this.namespace = cfg.namespace;
  }

  async isHealthy(key = 'temporal'): Promise<HealthIndicatorResult> {
    let connection: Connection | undefined;
    try {
      connection = await Connection.connect({ address: this.address });
      await connection.workflowService.describeNamespace({ namespace: this.namespace });
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'Temporal health check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch {
          // Swallowing close errors is acceptable for disposable health-check connections
        }
      }
    }
  }
}
