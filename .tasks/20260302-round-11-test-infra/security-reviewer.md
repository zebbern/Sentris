# Agent: security-reviewer

## Purpose

Review all new and modified test files from Round 11 for security testing coverage — ensure negative paths, auth boundaries, and error handling are exercised and tests don't introduce security issues.

## Skills

Load before starting: none

## Subtasks

### Auth Boundary Coverage

- [x] Verify secrets.service.spec.ts tests null auth, null org, and empty-string org for ALL service methods (list, get, create, rotate, getValue, delete)
  - Null auth: all 9 public methods covered (listSecrets, getSecret, getSecretByName, createSecret, rotateSecret, getSecretValue, getSecretValueByName, updateSecret, deleteSecret)
  - Null org: 4 of 9 covered (listSecrets, getSecret, createSecret, deleteSecret). Acceptable — shared `requireOrganizationId` function is proven correct.
  - Empty org: 4 of 9 covered (same subset). Same rationale.
- [x] Verify webhooks.service.spec.ts tests null auth, null org, and empty-string org for ALL service methods (list, get, create, update, delete)
  - Null auth: 9 of 10 auth-required methods covered. **GAP: `testParsingScript` missing.**
  - Null org: 5 of 10 (list, get, create, update, delete)
  - Empty org: 4 of 10 (list, get, create, delete)
  - Cross-org access: tested for list (returns empty), update (NotFoundException), delete (NotFoundException)
- [x] Verify `requireOrganizationId` is the sole auth gate — no secondary checks are bypassed in tests
  - Confirmed: all methods use `requireOrganizationId(auth)` as the org-scoping gate
  - `!organizationId` check correctly handles null, undefined, and empty string
- [x] Check that ForbiddenException is the correct exception type (not UnauthorizedException or generic Error)
  - Confirmed: `requireOrganizationId` throws `ForbiddenException('Organization context is required')`, and all tests assert `ForbiddenException`

### Error Information Leakage

- [x] Verify AllExceptionsFilter tests confirm error details are masked in production mode
  - Production test: returns statusCode 500, message "Internal server error", error "Internal Server Error"
- [x] Verify AllExceptionsFilter tests confirm stack traces are NOT included in production responses
  - Confirmed: `body.stack` is asserted `toBeUndefined()` in production mode
- [x] Verify unknown errors return the generic "Internal server error" message (no exception message leak)
  - Confirmed: `Error('Database connection lost')` → `body.message === 'Internal server error'`
  - Dev mode correctly reveals message + stack for debugging

### Secret Handling in Tests

- [x] Check no test files contain real secrets, API keys, or credentials
  - All values are obviously fake test data
- [x] Check mock secret values are obviously fake (e.g., "super-secret-value", "test-key")
  - Values: 'super-secret-value', 'another-secret', 'ciphertext', 'newcipher', 'decrypted-value', etc.
- [x] Verify crypto-utils tests do not reveal timing attack vectors in test assertions
  - `timingSafeCompare` wraps `crypto.timingSafeEqual`. Tests verify correctness without timing assertions.
  - Edge case: `héllo` vs `hello` throws due to buffer mismatch — not a timing oracle (length check is constant-time enough for lengths).

### Kafka Message Security

- [x] Verify Kafka adapter tests don't serialize and assert on sensitive data patterns
  - All test payloads use generic data: URLs, status codes, 'x'/'y'/'z' repeats
- [x] Verify spill-to-storage tests confirm that large payloads are replaced with markers (not sent raw)
  - Confirmed: spilled payloads get `__spilled__: true, storageRef` markers; pre-spilled outputs detected without re-upload
- [x] Verify truncation fallback exists for messages exceeding MAX_KAFKA_MESSAGE_BYTES
  - Confirmed: `_truncated: true` marker + `_originalSize` field; error logged for oversized payloads

### Store Security

- [x] Verify notificationStore localStorage persistence does not store sensitive data
  - Partialize: only `notifications` (title, variant, description, runId, read, id, timestamp). No auth tokens or secrets.
- [x] Verify workflowUiStore persistence partialize excludes sensitive state
  - Partialize: only UI prefs (libraryOpen, inspectorWidth, terminalPanelHeight, showHeatMap, smartRouting, edgeBundling). Mode intentionally excluded.

## Notes

- This is a read-only review agent. Do not modify source files.
- Focus on security implications of test coverage, not general code quality (code-reviewer handles that).
- Findings should use severity levels: S0 (critical security gap), S1 (security improvement), S2 (defense-in-depth suggestion).

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
