# Agent: tester-round10

## Purpose

Write unit tests for the new MutationCache global error handler, toast bridge module, and `suppressGlobalError` escape hatch.

## Skills

Load before starting: testing-patterns

## Required Reading

Before starting, read these files to understand what was implemented:

- `frontend/src/lib/queryClient.ts` — the MutationCache onError handler
- `frontend/src/lib/toastRef.ts` — the toast bridge module
- `frontend/src/lib/humanizeApiError.ts` — error mapping utility (already has tests at `frontend/src/lib/__tests__/humanizeApiError.test.ts`)
- `frontend/src/types/tanstack-query.d.ts` — meta type augmentation
- `frontend/src/lib/__tests__/` — existing test patterns and conventions

## Subtasks

### Phase A: Toast Bridge Tests

- [ ] Create test file `frontend/src/lib/__tests__/toastRef.test.ts`. Test that `showToast()` calls the registered toast function when `toastRef.current` is set.
- [ ] Test that `showToast()` does not throw when `toastRef.current` is null (graceful fallback). Verify a `console.warn` is emitted.
- [ ] Test that setting `toastRef.current = null` after registration prevents further toast calls (cleanup scenario).

### Phase B: MutationCache onError Tests

- [ ] Create test file `frontend/src/lib/__tests__/mutationErrorHandler.test.ts`. Test that the MutationCache `onError` callback calls `showToast` with `variant: 'destructive'` and the humanized error message when a mutation fails.
- [ ] Test that the toast `description` matches `humanizeApiError(error)` output for various error types: network error (`TypeError: Failed to fetch`), HTTP 403 (`{ statusCode: 403, message: 'Forbidden' }`), HTTP 500, and generic Error instances.
- [ ] Test that when a mutation has `meta: { suppressGlobalError: true }`, the global `onError` does NOT call `showToast`.
- [ ] Test that when a mutation has no `meta` (undefined), the global `onError` DOES call `showToast` (default behavior).
- [ ] Test that when a mutation has `meta: {}` (empty object, no `suppressGlobalError` key), the global `onError` DOES call `showToast`.

### Phase C: Integration Verification

- [ ] Verify all existing tests still pass (run `bun test` and confirm 390+ tests pass with no regressions). If any existing tests break due to the MutationCache addition, fix the test setup (e.g., tests that create their own QueryClient may need to account for the MutationCache).
- [ ] Check that no test files import removed toast code from pages. If any snapshot or component tests referenced the removed destructive toast calls, update them.

## Notes

- Use `vi.fn()` / `vi.spyOn()` for mocking the toast bridge. Don't mock `humanizeApiError` — test through it to verify the full error-to-message pipeline.
- The existing test file at `frontend/src/lib/__tests__/humanizeApiError.test.ts` already covers the `humanizeApiError` function itself. Your tests should focus on the MutationCache integration — that it calls `humanizeApiError` and passes the result to `showToast`.
- To test the MutationCache `onError` in isolation, you can extract the handler function or import it from `queryClient.ts` if the implementer exports it. Alternatively, instantiate a test `MutationCache` with the same `onError` logic.
- The test runner is Bun (`bun test`). Follow existing test patterns in `frontend/src/lib/__tests__/`.
- All new test files should follow the naming convention `*.test.ts` in the `__tests__` directory adjacent to the module being tested.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
