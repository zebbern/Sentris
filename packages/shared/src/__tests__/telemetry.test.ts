import { describe, expect, it } from 'bun:test';

import {
  DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS,
  DURABLE_TELEMETRY_KAFKA_RETRY,
  durableTelemetryKafkaProducerConfig,
} from '../telemetry.js';

describe('durable telemetry Kafka producer policy', () => {
  it('uses finite retries so the PostgreSQL fallback remains reachable', () => {
    const config = durableTelemetryKafkaProducerConfig();

    expect(config.idempotent).toBe(true);
    expect(config.retry.retries).toBeGreaterThanOrEqual(1);
    expect(config.retry.retries).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(config.retry).toEqual(DURABLE_TELEMETRY_KAFKA_RETRY);
    expect(DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('returns independent retry objects for KafkaJS consumers', () => {
    const first = durableTelemetryKafkaProducerConfig();
    const second = durableTelemetryKafkaProducerConfig();

    expect(first.retry).not.toBe(second.retry);
    expect(first.retry).toEqual(second.retry);
  });
});
