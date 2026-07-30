/**
 * Durable fallback event used only after a worker Kafka producer exhausts its
 * own retries. The backend outbox dispatcher republishes the exact serialized
 * message to one of the configured telemetry topics.
 */
export const DURABLE_KAFKA_PUBLISH_EVENT = 'telemetry.kafka.publish.v1';

/**
 * Idempotent KafkaJS producers otherwise default to effectively unbounded
 * retries. Telemetry uses bounded producer retries because the durable outbox
 * and consumer receipts provide the end-to-end replay/deduplication boundary.
 */
export const DURABLE_TELEMETRY_KAFKA_REQUEST_TIMEOUT_MS = 10_000;
export const DURABLE_TELEMETRY_KAFKA_RETRY = Object.freeze({
  retries: 3,
  initialRetryTime: 100,
  maxRetryTime: 2_000,
});

export function durableTelemetryKafkaProducerConfig() {
  return {
    allowAutoTopicCreation: true,
    idempotent: true,
    retry: { ...DURABLE_TELEMETRY_KAFKA_RETRY },
  } as const;
}

export interface DurableKafkaPublishPayload {
  topic: string;
  key: string | null;
  value: string;
}
