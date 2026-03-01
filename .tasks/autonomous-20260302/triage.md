# Triage: Round 10 — Centralized Mutation Error Handling

## Problem

All 16 mutation hook files in `frontend/src/hooks/queries/` lack `onError` callbacks. Error handling is scattered across ~15 calling components/pages. Many show destructive toasts with `humanizeApiError()`, some set inline form errors, and some may silently fail. This creates:

- Duplicate error-handling code (toast boilerplate in every page)
- Inconsistent error UX (some pages show toasts, others show inline errors, others do nothing)
- Risk of silent failures for mutations without any error handling

## Solution

Add a global `MutationCache` with an `onError` callback to the `QueryClient` configuration. This catches all mutation errors in one place, shows a destructive toast via `humanizeApiError()`, and provides a `meta.suppressGlobalError` escape hatch for mutations that have custom error handling.

## EXECUTION_PLAN

### Phase 1: Implementation

- **Agent**: implementer
- **Skills**: state-management-patterns
- **Purpose**: Add MutationCache global error handler, create toast bridge module, audit mutations and pages, add suppressGlobalError where needed, remove duplicate error toasts
- **Ordering**: Sequential (single phase)

### Phase 2: Testing

- **Agent**: tester
- **Skills**: testing-patterns
- **Purpose**: Unit tests for MutationCache onError, toast bridge, suppressGlobalError behavior
- **Ordering**: After Phase 1
- **Depends On**: Phase 1
