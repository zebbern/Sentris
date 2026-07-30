import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { REQUIRED_KAFKA_CONSUMER_TIMING } from '../kafka-consumer-timing';

describe('required Kafka consumer timing', () => {
  it('allows normal bounded sink latency without avoidable group eviction', () => {
    expect(REQUIRED_KAFKA_CONSUMER_TIMING.sessionTimeout).toBeGreaterThanOrEqual(30_000);
    expect(REQUIRED_KAFKA_CONSUMER_TIMING.heartbeatInterval).toBeLessThan(
      REQUIRED_KAFKA_CONSUMER_TIMING.sessionTimeout / 3,
    );
  });

  it('is shared by all four required telemetry consumers', async () => {
    const servicePaths = [
      '../../events/event-ingest.service.ts',
      '../../agent-trace/agent-trace-ingest.service.ts',
      '../../node-io/node-io-ingest.service.ts',
      '../../logging/log-ingest.service.ts',
    ];

    for (const servicePath of servicePaths) {
      const source = await readFile(new URL(servicePath, import.meta.url), 'utf8');
      expect(source).toContain('...REQUIRED_KAFKA_CONSUMER_TIMING');
    }
  });
});
