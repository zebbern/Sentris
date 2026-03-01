# Agent: implementer-round10

## Purpose

Add a global `MutationCache` with `onError` to the QueryClient, create a toast bridge module for non-React usage, and clean up duplicate error toast code across all pages/hooks.

## Skills

Load before starting: state-management-patterns

## Required Reading

Before starting, read these files to understand the current architecture:

- `frontend/docs/state.md` — state management conventions
- `frontend/src/lib/queryClient.ts` — current QueryClient config (no MutationCache)
- `frontend/src/lib/humanizeApiError.ts` — error-to-message mapping (use this in the global handler)
- `frontend/src/components/ui/toast-context.ts` — ToastContext types (ToastVariant, ToastOptions, ToastContextValue)
- `frontend/src/components/ui/toast-provider.tsx` — ToastProvider implementation (you'll wire the bridge here)
- `frontend/src/components/ui/use-toast.ts` — current React hook for toast (returns noopToast outside context)

## Subtasks

### Phase A: Infrastructure (toast bridge + MutationCache)

- [x] Create `frontend/src/lib/toastRef.ts` — a module-level toast bridge. Export a `toastRef` object with a nullable `current` property holding a reference to the toast function (matching `ToastContextValue['toast']` type), plus `showToast(options)` helper that calls `toastRef.current?.(options)` with a `console.warn` fallback if ref is null.
- [x] Modify `frontend/src/components/ui/toast-provider.tsx` — on mount, register the provider's `toast` function into `toastRef.current`. On unmount, set `toastRef.current = null`. This bridges React Context into module-level access.
- [x] Create `frontend/src/types/tanstack-query.d.ts` — add TanStack Query module augmentation to type `meta.suppressGlobalError` as `boolean | undefined`. Use the `Register` interface pattern from TanStack Query docs.
- [x] Modify `frontend/src/lib/queryClient.ts` — import `MutationCache` from `@tanstack/react-query`, import `humanizeApiError` and `showToast` from the bridge. Add a `MutationCache` instance with an `onError(error, _variables, _context, mutation)` callback that: (1) checks `mutation.meta?.suppressGlobalError === true` and returns early if so, (2) calls `showToast({ title: 'Operation failed', description: humanizeApiError(error), variant: 'destructive' })`. Pass the `MutationCache` to the `QueryClient` constructor.
- [x] Verify the app still boots and a mutation error (e.g., deleting a nonexistent resource) shows a global destructive toast.

### Phase B: Audit mutations for suppressGlobalError

Audit all mutation hooks in `frontend/src/hooks/queries/` and their calling components. Add `meta: { suppressGlobalError: true }` ONLY to mutations whose calling components display errors inline (not via toast). The standard is: if the ONLY error handling is a destructive toast in a catch block, the global handler replaces it (no suppress needed). If the component sets inline error state (`setFormError`, `setEditError`, `ErrorBanner` based on `mutation.error`, etc.), add suppress.

- [x] Audit `useSecretQueries.ts` — `useCreateSecret`, `useUpdateSecret`, `useRotateSecret` are called by `SecretsManager.tsx` which uses `setFormError(message)` / `setEditError(message)` for create/update/rotate errors (inline display, no toast). Add `meta: { suppressGlobalError: true }` to these three mutations. `useDeleteSecret` is called with a destructive toast in the catch — do NOT suppress it.
- [x] Audit all other mutation hooks. Check each mutation's calling component(s) for inline error handling patterns. For any that use inline error display (e.g., form error state, `ErrorBanner` reading from `mutation.error`), add `meta: { suppressGlobalError: true }`. Document which mutations were suppressed and why.

### Phase C: Remove duplicate catch-block toasts

For pages/hooks that show a destructive toast via `humanizeApiError()` in a catch block, remove the toast call. The global MutationCache handler now handles this. Keep the catch block if it does other work (logging, state cleanup, dialog closing). Remove the entire catch block only if its sole purpose was showing a toast.

**Important**: Only remove toasts from catch blocks that use `mutateAsync()` with try/catch. The global handler fires for ALL mutations regardless. Pages using the `.mutate()` callback pattern don't have catch blocks — they're already covered.

- [x] Clean `WebhooksPage.tsx` — remove destructive toast calls from catch blocks (~lines 195, 221, 250). These use `humanizeApiError(err)` for delete, regenerate, toggle operations. Keep other catch-block logic if present.
- [x] Clean `SchedulesPage.tsx` — remove destructive toast calls from catch blocks (~lines 293, 312, 330, 357). These cover create, update, delete, toggle operations.
- [x] Clean `McpLibraryPage.tsx` — remove destructive toast calls from catch blocks (~lines 239, 257 and others).
- [x] Clean `mcp-library/useGroupActions.ts` — remove destructive toast calls (~lines 154, 174, 194, 216, 246). SKIPPED: These use direct API calls (not TanStack Query mutations), so the global MutationCache handler doesn't cover them. Toasts must stay.
- [x] Clean `mcp-library/useEditorActions.ts` — remove destructive toast calls (~lines 232, 262, 287).
- [x] Clean `mcp-library/useJsonImport.ts` — remove destructive toast calls (~lines 210, 323). Check for any empty `.catch(() => {})` that silently swallows errors — if found, remove the catch entirely so the global handler can fire.
- [x] Clean `webhook-editor/useWebhookEditor.ts` — remove destructive toast calls (~lines 139, 209, 240, 292). Note: only lines 240 and 292 cleaned (handleSave, handleDelete). Line 139 is a query error toast, not mutation. Line 209 is testScript with suppressGlobalError.
- [x] Clean `TemplateLibraryPage.tsx` — remove destructive toast call (~line 83). Also removed unused `humanizeApiError` and `useToast` imports.
- [x] Clean `ApiKeysManager.tsx` — remove destructive toast calls (~lines 110, 129). Also removed unused `humanizeApiError` import.
- [x] Clean `WorkflowList.tsx` — remove destructive toast calls from delete/clone catch blocks (~lines 130, 155). Note: these have context-specific titles like "Delete failed" — the global handler uses generic "Operation failed" title. This is acceptable; the `humanizeApiError` description carries the useful information.
- [x] Clean `AnalyticsSettingsPage.tsx` — remove destructive toast call from catch block (~line 153). The inline `ErrorBanner` at line 266 still works via `updateMutation.error` and is separate from the toast.
- [x] Scan for any other pages/hooks with duplicate destructive toast patterns in mutation catch blocks. Use `grep_search` for `variant: 'destructive'` near `humanizeApiError` in `.tsx` and `.ts` files. Clean up any found.

### Phase D: Validation

- [x] Verify all existing 390 tests pass (`bun test` in frontend directory).
- [x] Verify the app boots without errors in the console.
- [x] Verify that `humanizeApiError` import can be removed from pages where it was only used for the catch-block toast (reduce unused imports). Do NOT remove it from pages that still use it for inline error display or non-mutation contexts.

## Notes

- The toast system is React Context-based (`ToastContext`). The MutationCache `onError` callback runs outside React, which is why the toast bridge module is necessary. The bridge is a lightweight module-level ref pattern — not a global event bus.
- `humanizeApiError()` already handles all error shapes: network errors, HTTP status code mapping (401, 403, 409, 422, 5xx), Error instances, and string errors. No changes needed to this file.
- The `useToast()` hook returns a `noopToast` (logs warning) if called outside ToastContext. The bridge must be registered INSIDE the provider, not from the hook.
- The backend returns `{ message, statusCode, error }` on errors — `humanizeApiError` already handles this format.
- Some catch blocks may also contain success-path logic via `try { await mutateAsync(); toast({ variant: 'success', ... }) } catch { toast({ variant: 'destructive', ... }) }`. Only remove the destructive toast in the catch — do not touch the success toast in the try block.
- Line numbers are approximate — verify by reading each file before editing.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
