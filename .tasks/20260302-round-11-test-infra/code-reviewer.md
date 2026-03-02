# Agent: code-reviewer

## Purpose

Review all new and modified test files from Round 11 for correctness, completeness, and adherence to project conventions.

## Skills

Load before starting: none

## Subtasks

### General Quality

- [x] Verify all test files use `bun:test` imports (not Jest/Vitest globals) — ✅ All 14 files confirmed
- [x] Verify mock functions use `vi.fn()` consistently — ✅ Confirmed
- [x] Verify `describe/it/expect` pattern is followed throughout — ✅ Confirmed
- [x] Check that no tests use `test()` instead of `it()` (project convention) — ✅ Confirmed

### Backend Common Tests

- [x] Review `backend/src/common/__tests__/all-exceptions.filter.spec.ts` — ✅ Mocks realistic, all branches covered (HttpException string/object, unknown errors prod/dev, SSE/headersSent, logging 4xx/5xx)
- [x] Review `backend/src/common/__tests__/logging.interceptor.spec.ts` — ✅ RxJS subscribe/error/complete correctly tested. Minor lint issue (S3).
- [x] Review `backend/src/common/__tests__/kafka-topic-resolver.spec.ts` — ✅ Singleton reset in beforeEach, all topic methods, instance suffix, isInstanceIsolated, getInstanceId all tested
- [x] Review `backend/src/common/__tests__/postgres-error.spec.ts` — ✅ Excellent edge cases: null, undefined, non-object, nested cause, numeric code, cause-without-code, primitive cause
- [x] Review `backend/src/common/__tests__/crypto-utils.spec.ts` — ✅ Edge cases covered. Documents known byte-length-mismatch throw behavior (S2 finding on source code).

### Worker Kafka Adapter Tests

- [x] Review `worker/src/adapters/__tests__/kafka-agent-trace.adapter.test.ts` — ✅ Producer mock correct, connect-before-send ordering verified, error logging tested
- [x] Review `worker/src/adapters/__tests__/kafka-log.adapter.test.ts` — ✅ Chunking math uses LOG_CHUNK_SIZE_CHARS constant, empty/whitespace skip, timestamp serialization all tested
- [x] Review `worker/src/adapters/__tests__/kafka-nodeio.adapter.test.ts` — ✅ Spill threshold uses KAFKA_SPILL_THRESHOLD_BYTES constant, pre-spilled detection, MAX_KAFKA_MESSAGE_BYTES truncation tested
- [x] Review `worker/src/adapters/__tests__/kafka-trace.adapter.test.ts` — ✅ Sequence numbering, independent counters, finalizeRun reset, packData combinations (4/4), metadata lifecycle all tested

### Frontend Store Tests

- [x] Review `frontend/src/store/__tests__/notificationStore.test.ts` — ✅ FIFO limit at 50 verified, selectUnreadCount selector tested, unused import (S3)
- [x] Review `frontend/src/store/__tests__/workflowStore.test.ts` — ✅ Dirty tracking, reset, partial merge, idempotent markClean all tested
- [x] Review `frontend/src/store/__tests__/workflowUiStore.test.ts` — ✅ Mode switching, clamping, rounding, terminal dock/undock/clear, toggle behaviors all tested. Typo in test name (S3).

### Negative Auth Tests

- [x] Review secrets.service.spec.ts additions — ⚠️ S2: null/empty org sections only cover 4 of 9 methods (missing rotateSecret, getSecretValue, getSecretValueByName, updateSecret, getSecretByName)
- [x] Review webhooks.service.spec.ts additions — ⚠️ S2: null org covers 5 of 9 methods, empty org covers 4 of 9 (missing regeneratePath, getUrl, listDeliveries, getDelivery, update)

### Cross-Cutting

- [x] Check no test file has hardcoded secrets, tokens, or passwords — ✅ Only test fixture strings like 'secret-key-123' (not real credentials)
- [x] Check all async tests properly await assertions (no floating promises) — ✅ All async assertions use `await expect(...).rejects.toThrow()` or proper Promise resolution
- [x] Check test isolation — no shared mutable state between tests without proper reset — ✅ All files use beforeEach with proper mock clears / state resets

## Notes

- This is a read-only review agent. Do not modify source files.
- Findings should use severity levels: S0 (blocker), S1 (must-fix), S2 (suggestion).

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
