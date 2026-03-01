# Plan: Round 10 — Centralized Mutation Error Handling via Global MutationCache

## Overview

Add a global `MutationCache` with `onError` to the TanStack Query `QueryClient` so every mutation error automatically shows a destructive toast with a human-friendly message. Provide a `meta.suppressGlobalError` escape hatch for mutations with custom inline error handling. Remove duplicate catch-block toasts from pages once the global handler covers them.

## Architecture Decisions

| Decision                                                    | Alternatives                                                                                                                  | Rationale                                                                                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Toast bridge module (module-level ref)                      | 1) Import toast directly (impossible — React Context) 2) Custom event emitter 3) Module-level ref registered by ToastProvider | Toast system is React Context-based (`useToast()` hook). MutationCache `onError` runs outside React. A module-level ref that ToastProvider registers into on mount is the simplest bridge. |
| `meta.suppressGlobalError` escape hatch                     | 1) Per-mutation onError override 2) Error subclass checking 3) Meta flag                                                      | Meta flag is the TanStack Query convention for mutation metadata. It's explicit, auditable, and doesn't interfere with the global handler's logic.                                         |
| TanStack Query module augmentation for meta types           | 1) Cast `meta` at each call site 2) Module augmentation via `Register` interface                                              | Module augmentation provides type-safe `meta.suppressGlobalError` everywhere without casts.                                                                                                |
| Remove catch-block toasts, keep catch-block logging/cleanup | 1) Remove entire catch blocks 2) Keep catch blocks but remove only the toast call                                             | Catch blocks often do more than toast (e.g., logging, state cleanup). Only the toast display is duplicate; other logic must remain.                                                        |

## Affected Files

| Action | File Path                                                 | Change Description                                                                               |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| CREATE | `frontend/src/lib/toastRef.ts`                            | Module-level toast ref bridge for non-React usage                                                |
| MODIFY | `frontend/src/lib/queryClient.ts`                         | Add MutationCache with global onError handler                                                    |
| MODIFY | `frontend/src/components/ui/toast-provider.tsx`           | Register toast function into toastRef on mount/unmount                                           |
| CREATE | `frontend/src/types/tanstack-query.d.ts`                  | Module augmentation for `meta.suppressGlobalError` type                                          |
| MODIFY | `frontend/src/hooks/queries/useSecretQueries.ts`          | Add `meta: { suppressGlobalError: true }` to create/update/rotate mutations (inline form errors) |
| MODIFY | Multiple pages/hooks with catch blocks                    | Remove duplicate destructive toast calls; keep other catch logic                                 |
| CREATE | `frontend/src/lib/__tests__/mutationErrorHandler.test.ts` | Unit tests for MutationCache onError and toast bridge                                            |

## Phases

| Phase | Agents      | Purpose                                                                                               | Depends On |
| ----- | ----------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| 1     | implementer | Create toast bridge, add MutationCache, augment types, audit mutations/pages, remove duplicate toasts | —          |
| 2     | tester      | Unit tests for global error handler, toast bridge, suppressGlobalError                                | Phase 1    |

## Dependencies

- Tester depends on implementer completing the MutationCache and toast bridge before writing tests.
- Implementer must audit all 16 mutation hook files and their calling components to determine which mutations need `suppressGlobalError`.

## Risk Assessment

| Risk                                                                             | Impact                                               | Mitigation                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Toast bridge ref is null before ToastProvider mounts                             | Global handler silently fails to show toast          | Add `console.warn` fallback in bridge when ref is null; ToastProvider mounts early in app tree |
| Removing catch-block toasts breaks pages that rely on catch for state cleanup    | Page behavior breaks (e.g., form not reset on error) | Only remove the `toast()` call from catch blocks, not the entire catch block                   |
| Some mutations intentionally have no error feedback (fire-and-forget)            | Global handler adds unwanted toasts for these        | Audit all mutations; add `suppressGlobalError` to any that should be silent                    |
| Double toast on pages with both catch toast and global handler during transition | Users see duplicate toasts during development        | Remove catch toasts in same PR as adding global handler — atomic change                        |
