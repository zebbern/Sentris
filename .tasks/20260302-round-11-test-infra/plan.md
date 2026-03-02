# Plan: Round 11 — Test Infrastructure Coverage

## Overview

Add unit tests for untested backend common infrastructure, worker Kafka adapters, frontend Zustand stores, and negative auth paths. All tests follow existing project conventions (bun:test, vi.fn(), describe/it/expect). No source code changes — purely additive test files.

## Architecture Decisions

| Decision                                                      | Alternatives                             | Rationale                                                                                                                |
| ------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Place backend common tests in `backend/src/common/__tests__/` | Co-locate next to source files           | Matches project convention: tests in `__tests__/` folders                                                                |
| Mock KafkaJS Producer at module level                         | Use dependency injection                 | Kafka adapters instantiate Producer internally; module-level mock is the standard pattern used by existing adapter tests |
| Test Zustand stores by calling actions and asserting state    | Render components                        | Store tests should be pure logic tests — no DOM needed (matches existing authStore/themeStore pattern)                   |
| Extend existing spec files for negative auth                  | Create separate negative-auth spec files | Keeps related tests together; existing specs already have the mock setup                                                 |

## Affected Files

| Action | File Path                                                         | Change Description                          |
| ------ | ----------------------------------------------------------------- | ------------------------------------------- |
| CREATE | `backend/src/common/__tests__/all-exceptions.filter.spec.ts`      | Tests for AllExceptionsFilter               |
| CREATE | `backend/src/common/__tests__/logging.interceptor.spec.ts`        | Tests for LoggingInterceptor                |
| CREATE | `backend/src/common/__tests__/kafka-topic-resolver.spec.ts`       | Tests for KafkaTopicResolver                |
| CREATE | `backend/src/common/__tests__/postgres-error.spec.ts`             | Tests for getPostgresErrorCode and PG_ERROR |
| CREATE | `backend/src/common/__tests__/crypto-utils.spec.ts`               | Tests for timingSafeCompare                 |
| CREATE | `worker/src/adapters/__tests__/kafka-agent-trace.adapter.test.ts` | Tests for KafkaAgentTracePublisher          |
| CREATE | `worker/src/adapters/__tests__/kafka-log.adapter.test.ts`         | Tests for KafkaLogAdapter                   |
| CREATE | `worker/src/adapters/__tests__/kafka-nodeio.adapter.test.ts`      | Tests for KafkaNodeIOAdapter                |
| CREATE | `worker/src/adapters/__tests__/kafka-trace.adapter.test.ts`       | Tests for KafkaTraceAdapter                 |
| CREATE | `frontend/src/store/__tests__/notificationStore.test.ts`          | Tests for notificationStore                 |
| CREATE | `frontend/src/store/__tests__/workflowStore.test.ts`              | Tests for workflowStore                     |
| CREATE | `frontend/src/store/__tests__/workflowUiStore.test.ts`            | Tests for workflowUiStore                   |
| MODIFY | `backend/src/secrets/__tests__/secrets.service.spec.ts`           | Add negative auth describe block            |
| MODIFY | `backend/src/webhooks/__tests__/webhooks.service.spec.ts`         | Add negative auth describe block            |

## Phases

| Phase | Agents                                                             | Purpose                                                | Depends On  |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------ | ----------- |
| 1     | tester-backend-common, tester-worker-kafka, tester-frontend-stores | Write all new test files (independent, parallelizable) | —           |
| 2     | tester-negative-auth                                               | Add negative auth tests to existing spec files         | —           |
| 3     | code-reviewer, security-reviewer                                   | Review all new/modified test files                     | Phase 1 + 2 |

## Dependencies

- Phase 1 agents are fully independent — no cross-dependencies.
- Phase 2 (negative-auth) is independent of Phase 1 but serialized for review clarity.
- Phase 3 reviewers need all test files committed before reviewing.

## Risk Assessment

- **Low risk**: All changes are additive test files. No production code is modified.
- **Mock fidelity**: Kafka adapter mocks must match KafkaJS Producer interface (connect, send, disconnect). Existing adapter tests (`trace.adapter.test.ts`, `secrets.adapter.test.ts`) provide proven patterns.
- **Store test isolation**: Zustand stores with `persist` middleware need localStorage mocking or store reset between tests.
