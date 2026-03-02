# Agent: tester-worker-kafka

## Purpose

Create unit tests for all four Kafka adapter modules in `worker/src/adapters/`: KafkaAgentTracePublisher, KafkaLogAdapter, KafkaNodeIOAdapter, KafkaTraceAdapter.

## Skills

Load before starting: testing-patterns

## Subtasks

### KafkaAgentTracePublisher (`worker/src/adapters/__tests__/kafka-agent-trace.adapter.test.ts`)

- [x] Create test file with KafkaJS Producer mock (connect, send, disconnect as vi.fn()) — follow existing adapter test patterns
- [x] Test constructor throws ConfigurationError when `brokers` array is empty
- [x] Test `publish(event)` sends a JSON-serialized message to the configured topic
- [x] Test that `publish` awaits the connect promise before sending
- [x] Test that send errors are caught and logged via logger.error (not re-thrown)

### KafkaLogAdapter (`worker/src/adapters/__tests__/kafka-log.adapter.test.ts`)

- [x] Create test file with KafkaJS Producer mock and import LOG_CHUNK_SIZE_CHARS from `@sentris/component-sdk`
- [x] Test constructor throws ConfigurationError when `brokers` is empty
- [x] Test `append(entry)` sends a single message for short log entries (under LOG_CHUNK_SIZE_CHARS)
- [x] Test `append(entry)` skips sending when `entry.message` is empty or whitespace-only
- [x] Test log chunking: a message exceeding LOG_CHUNK_SIZE_CHARS is split into multiple Kafka messages with `[Chunk N/M]` indicators
- [x] Test that the timestamp is serialized to ISO string format
- [x] Test that send errors are caught and logged (not re-thrown)

### KafkaNodeIOAdapter (`worker/src/adapters/__tests__/kafka-nodeio.adapter.test.ts`)

- [x] Create test file with KafkaJS Producer mock and IFileStorageService mock (uploadFile as vi.fn())
- [x] Test constructor throws ConfigurationError when `brokers` is empty
- [x] Test `recordStart(data)` serializes a NODE_IO_START event with correct fields (runId, nodeRef, workflowId, organizationId, componentId, inputs, timestamp)
- [x] Test `recordCompletion(data)` serializes a NODE_IO_COMPLETION event with correct fields (status, outputs, errorMessage)
- [x] Test spill-to-storage for inputs: when input JSON exceeds KAFKA_SPILL_THRESHOLD_BYTES and storage is available, call `storage.uploadFile` and replace inputs with a spill marker
- [x] Test spill-to-storage for outputs: same threshold logic for output data
- [x] Test pre-spilled output detection: when outputs already contain `__sentris_spilled__` marker, extract storageRef without re-uploading
- [x] Test final safety check: when serialized payload exceeds MAX_KAFKA_MESSAGE_BYTES even after spilling, truncate with `_truncated` marker
- [x] Test that the message key is set to `runId`
- [x] Test that critical errors are logged but not thrown (graceful failure)

### KafkaTraceAdapter (`worker/src/adapters/__tests__/kafka-trace.adapter.test.ts`)

- [x] Create test file with KafkaJS Producer mock
- [x] Test constructor throws ConfigurationError when `brokers` is empty
- [x] Test `setRunMetadata` / `finalizeRun` lifecycle: metadata is available during the run and cleaned up after
- [x] Test `record(event)` serializes the event with correct fields including workflowId and organizationId from metadata
- [x] Test sequence numbering: consecutive events for the same runId have incrementing sequence numbers (1, 2, 3…)
- [x] Test sequence isolation: different runIds maintain independent sequence counters
- [x] Test `packData`: event.data is packed under `_payload`, event.context under `_metadata`, returns null when both are absent
- [x] Test that send errors are caught and logged as CRITICAL (not re-thrown)

## Notes

- Follow the mock pattern from existing tests in `worker/src/adapters/__tests__/` (e.g., `trace.adapter.test.ts`, `secrets.adapter.test.ts`).
- Mock KafkaJS at the module level: `vi.mock('kafkajs', ...)` returning a factory that captures the mock producer.
- For spill tests in KafkaNodeIOAdapter, use `KAFKA_SPILL_THRESHOLD_BYTES` and `MAX_KAFKA_MESSAGE_BYTES` from `@sentris/component-sdk` to generate appropriately sized payloads.
- `KafkaTraceAdapter.record()` is fire-and-forget (void return, sends asynchronously) — test the producer.send calls, not the return value.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
