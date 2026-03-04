# Agent: researcher (kafkajs Evaluation)

## Purpose

Evaluate replacements for the abandoned `kafkajs` package (last release 2023, no security patches) and recommend go/no-go on migration. This is a read-only research task — do not modify any source code.

## Skills

Load before starting: none

## Subtasks

### Current Usage Analysis

- [x] Inventory all kafkajs usage in the codebase — currently known: 4 producer adapters in `worker/src/adapters/kafka-*.adapter.ts` and 4 consumer services in `backend/src/*/ingest.service.ts`. Confirm the full list.
- [x] Document which kafkajs APIs are used: `Kafka` constructor, `Producer` (connect, send, disconnect), `Consumer` (connect, subscribe, run, disconnect), `logLevel`. Note any advanced features (transactions, admin API, SASL config, custom partitioners).
- [x] Check if any kafkajs-specific configuration or behavior is relied upon (e.g., retry policies, error types, specific producer options like `acks`, `compression`).

### Candidate Evaluation

- [x] Evaluate `@confluentinc/kafka-javascript` (Confluent's official client): check npm for latest version, release activity, maintenance status, Redpanda compatibility claims, API surface similarity to kafkajs
- [x] Evaluate `kafkajs-next` or any community fork: check if it exists, maintenance status, whether it patches known vulnerabilities
- [x] Check if Redpanda has any officially recommended Node.js client library
- [x] For each candidate, assess: (1) API compatibility with kafkajs, (2) Redpanda compatibility, (3) maintenance/release cadence, (4) bundle size impact, (5) TypeScript support quality, (6) any known issues or breaking changes from kafkajs migration

### Redpanda Compatibility

- [x] Verify that the recommended replacement works with Redpanda (the project uses Redpanda, not Apache Kafka). Check Redpanda docs, GitHub issues, and community reports.
- [x] Note any Redpanda-specific configuration needed for the replacement library

### Migration Effort Assessment

- [x] Assess the API migration effort: can imports be swapped with minimal code changes, or does the replacement have a fundamentally different API?
- [x] Identify breaking changes between kafkajs and the recommended replacement
- [x] Estimate scope: how many files need changes, and roughly how complex are the changes?

### Recommendation

- [x] Provide a clear GO or NO-GO recommendation with rationale
- [x] If GO: specify the recommended package, version, and key migration notes
- [x] If NO-GO: explain why (e.g., no compatible replacement exists, migration risk too high) and recommend alternative mitigation (e.g., fork kafkajs, pin version, monitor CVEs)

## Notes

- kafkajs is at `^2.2.4` in both `worker/package.json` and `backend/package.json`.
- The project uses Redpanda (Kafka-compatible) as the message broker, configured in `docker/docker-compose.infra.yml`.
- The adapter pattern in the worker (e.g., `KafkaNodeIOAdapter`, `KafkaTraceAdapter`) provides a clean abstraction boundary — migration should primarily affect the adapter internals, not the callers.
- The backend consumers (`*-ingest.service.ts`) are NestJS services that create Kafka consumers directly.
- This is a READ-ONLY task. Do not modify source code. Output your findings in the RESULT block.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
