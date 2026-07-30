import type { KafkaMessageIdentity } from '../outbox/outbox.repository';

interface KafkaPoisonRecorder {
  recordKafkaPoisonMessage(
    identity: KafkaMessageIdentity,
    rawPayload: Buffer,
    error: unknown,
    organizationId: string | null,
  ): Promise<void>;
}

export async function recordEmptyRequiredKafkaPayload(
  recorder: KafkaPoisonRecorder,
  identity: KafkaMessageIdentity,
): Promise<void> {
  await recorder.recordKafkaPoisonMessage(
    identity,
    Buffer.alloc(0),
    new Error('Kafka message payload is empty'),
    null,
  );
}
