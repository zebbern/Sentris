import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { DURABLE_KAFKA_PUBLISH_EVENT, type DurableKafkaPublishPayload } from '@sentris/shared';

export interface DurableKafkaFallbackInput extends DurableKafkaPublishPayload {
  organizationId: string | null;
}

export interface DurableKafkaFallback {
  enqueue(input: DurableKafkaFallbackInput): Promise<void>;
}

type QueryExecutor = Pick<Pool, 'query'>;
type FailureReporter = (message: string) => void;

export class PostgresDurableKafkaFallback implements DurableKafkaFallback {
  constructor(
    private readonly database: QueryExecutor,
    private readonly onFailure?: FailureReporter,
  ) {}

  async enqueue(input: DurableKafkaFallbackInput): Promise<void> {
    const payload: DurableKafkaPublishPayload = {
      topic: input.topic,
      key: input.key,
      value: input.value,
    };
    const messageIdentity = createHash('sha256')
      .update(JSON.stringify([input.topic, input.key, input.value]))
      .digest('hex');

    try {
      await this.database.query(
        `
          INSERT INTO outbox_events (
            event_type,
            organization_id,
            aggregate_type,
            aggregate_id,
            dedupe_key,
            payload
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          ON CONFLICT (dedupe_key) DO NOTHING
        `,
        [
          DURABLE_KAFKA_PUBLISH_EVENT,
          input.organizationId,
          'telemetry_delivery',
          messageIdentity,
          `${DURABLE_KAFKA_PUBLISH_EVENT}:${messageIdentity}`,
          JSON.stringify(payload),
        ],
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.onFailure?.(
        `Kafka delivery and the durable PostgreSQL fallback both failed: ${message}`,
      );
      throw error;
    }
  }
}

interface PublishWithFallbackInput {
  publish: () => Promise<void>;
  fallback?: DurableKafkaFallback;
  publication: DurableKafkaFallbackInput;
  source: string;
  logger: Pick<Console, 'error'>;
}

/**
 * Keeps Kafka as the zero-database-I/O fast path. Only an exhausted producer
 * failure enters the PostgreSQL outbox, where normal outbox retry and
 * dead-letter reconciliation semantics apply.
 */
export async function publishWithDurableFallback(input: PublishWithFallbackInput): Promise<void> {
  try {
    await input.publish();
    return;
  } catch (kafkaError: unknown) {
    if (!input.fallback) {
      throw kafkaError;
    }

    try {
      await input.fallback.enqueue(input.publication);
    } catch (fallbackError: unknown) {
      input.logger.error(
        `[${input.source}] CRITICAL: Kafka retries and durable PostgreSQL fallback both failed.`,
        {
          kafkaError,
          fallbackError,
        },
      );
      throw fallbackError;
    }

    input.logger.error(
      `[${input.source}] Kafka retries were exhausted; publication queued in the durable PostgreSQL outbox.`,
    );
  }
}
