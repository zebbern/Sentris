# Agent: tester-negative-auth

## Purpose

Extend existing secrets.service.spec.ts and webhooks.service.spec.ts with negative authentication path tests: null auth context, null organization ID, wrong organization ID, and non-existent resource IDs.

## Skills

Load before starting: testing-patterns

## Subtasks

### secrets.service.spec.ts (`backend/src/secrets/__tests__/secrets.service.spec.ts`)

- [x] Add a `describe('negative auth paths')` block inside the existing top-level describe
- [x] Test that `listSecrets(null)` throws ForbiddenException ("Organization context is required")
- [x] Test that `getSecret(null, 'id')` throws ForbiddenException
- [x] Test that `createSecret(null, input)` throws ForbiddenException
- [x] Test that `rotateSecret(null, 'id', input)` throws ForbiddenException
- [x] Test that `getSecretValue(null, 'id')` throws ForbiddenException
- [x] Test that `deleteSecret(null, 'id')` throws ForbiddenException
- [x] Test with auth context that has `organizationId: null` — should throw ForbiddenException
- [x] Test with auth context that has `organizationId: ''` (empty string) — should throw ForbiddenException
- [x] Test that `getSecret(auth, 'non-existent-id')` behaves correctly when repository returns null/undefined (NotFoundException or null return — match actual service behavior)
- [x] Test that `getSecretValue(auth, 'non-existent-id')` when repository returns null — verify error handling

### webhooks.service.spec.ts (`backend/src/webhooks/__tests__/webhooks.service.spec.ts`)

- [x] Add a `describe('negative auth paths')` block inside the existing top-level describe
- [x] Test that `list(null)` throws ForbiddenException
- [x] Test that `get(null, 'id')` throws ForbiddenException
- [x] Test that `create(null, input)` throws ForbiddenException
- [x] Test that `update(null, 'id', input)` throws ForbiddenException
- [x] Test that `delete(null, 'id')` throws ForbiddenException
- [x] Test with auth context that has `organizationId: null` — should throw ForbiddenException
- [x] Test with auth context that has `organizationId: ''` (empty string) — should throw ForbiddenException
- [x] Verify existing non-existent ID tests cover get, update, delete (already partially present — confirm coverage and add any missing)

## Notes

- Both services use `requireOrganizationId(auth)` which throws `ForbiddenException` when `auth` is null or `auth.organizationId` is falsy.
- The existing spec files already have the full mock infrastructure set up — reuse the existing `repository`, `encryption`, `auditLogService` mocks.
- The webhooks spec already has some non-existent ID tests (get, update, delete throw NotFoundException). Verify coverage is complete and add any gaps.
- The secrets spec currently has NO negative auth tests — these are entirely new.
- Import `ForbiddenException` from `@nestjs/common` in the secrets spec (webhooks spec already imports NestJS exceptions).

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
