# Agent: tester (frontend)

## Purpose

Add unit tests for the untested auth layer (`ProtectedRoute`, `useAuth`, `usePermissions`) and high-priority query hooks (`useMcpServersQuery`, `useWorkflowsQuery`, `useSecretsQuery` mutations) in the frontend.

## Skills

Load before starting: testing-patterns

## Subtasks

### Understand existing test patterns

- [x] Read `frontend/src/test/render-with-providers.tsx` to understand the shared test wrapper (MemoryRouter + QueryClientProvider) and `renderHookWithProviders` helper
- [x] Read `frontend/src/hooks/queries/__tests__/useDeleteWorkflow.test.tsx` to understand the pattern for testing query hooks — how `mock.module` is used for `@/services/api`, how mutations are tested with `act()` + `mutateAsync`, and how cache invalidation is verified
- [x] Read `frontend/src/auth/types.ts` and `frontend/src/auth/auth-context-def.ts` to understand the `FrontendAuthProvider` interface and `GlobalAuthContext` shape

### Test `ProtectedRoute` component

- [x] Create `frontend/src/components/auth/__tests__/ProtectedRoute.test.tsx`
- [x] Test: when `isAuthenticated=true` and `isLoading=false`, renders children
- [x] Test: when `isLoading=true`, renders loading state (not children)
- [x] Test: when `isAuthenticated=false` and `requireAuth=true` (default), does NOT render children — shows sign-in UI or fallback
- [x] Test: when `requireAuth=false`, renders children regardless of auth state
- [x] Test: when `roles` prop is set and user has matching role, renders children
- [x] Test: when `roles` prop is set and user does NOT have matching role, renders access denied
- [x] Test: when `requireOrg=true` and user has no `organizationId`, renders org-required state
- [x] Mock auth context by wrapping tests in a `GlobalAuthContext.Provider` with a controlled `FrontendAuthProvider` value

### Test `useAuth` hook

- [x] Create `frontend/src/auth/__tests__/useAuth.test.tsx`
- [x] Test: `useAuth()` returns the provider's context (user, token, isLoading, isAuthenticated)
- [x] Test: when no provider is set in `GlobalAuthContext`, `useAuth()` returns the fallback (isAuthenticated=false, isLoading=true, user=null)
- [x] Test: `useAuthProvider()` returns the full provider object including signIn/signOut/signUp methods
- [x] Mock auth context by wrapping the hook in `GlobalAuthContext.Provider`

### Test `usePermissions` hook

- [x] Create `frontend/src/components/auth/__tests__/usePermissions.test.tsx`
- [x] Test: `hasRole(['ADMIN'])` returns true when user's `organizationRole` is `admin` (case-insensitive match)
- [x] Test: `hasRole(['ADMIN'])` returns false when user has a different role
- [x] Test: `hasRole(['*'])` returns true for any authenticated user with a role
- [x] Test: `hasOrg()` returns true when user has an `organizationId`, false otherwise
- [x] Test: `canAccess({ requireAuth: true })` returns false when not authenticated
- [x] Test: `canAccess({ requireOrg: true })` returns false when user has no org
- [x] Test: `canAccess({ roles: ['ADMIN'] })` returns false when user lacks the role
- [x] Mock auth context by wrapping the hook in `GlobalAuthContext.Provider`

### Test `useSecretQueries` mutation hooks

- [x] Create `frontend/src/hooks/queries/__tests__/useSecretQueries.test.tsx`
- [x] Mock `@/services/api` with `vi.fn()` stubs for `api.secrets.create`, `api.secrets.update`, `api.secrets.rotate`, `api.secrets.delete`, `api.secrets.list`
- [x] Test `useCreateSecret` — call `mutateAsync` with a `CreateSecretInput`, verify `api.secrets.create` is called, verify `queryKeys.secrets.all()` queries are invalidated on success
- [x] Test `useUpdateSecret` — call `mutateAsync` with `{ id, input }`, verify `api.secrets.update(id, input)` is called
- [x] Test `useRotateSecret` — call `mutateAsync` with `{ id, input }`, verify `api.secrets.rotate(id, input)` is called
- [x] Test `useDeleteSecret` — call `mutateAsync` with an id, verify `api.secrets.delete(id)` is called and secret queries are invalidated

### Test `useMcpServerQueries` hooks

- [x] Create `frontend/src/hooks/queries/__tests__/useMcpServerQueries.test.tsx`
- [x] Mock `fetch` or the `apiRequest` helper used by MCP server queries
- [ ] Test `useMcpServers` — verify it calls the correct API path and returns server list data
- [x] Test `useCreateMcpServer` mutation — verify it posts to the correct endpoint and invalidates MCP server queries on success
- [x] Test `useDeleteMcpServer` mutation — verify it sends DELETE and invalidates queries
- [ ] Test `useDiscoverMcpTools` mutation — verify it triggers tool discovery and invalidates tool queries

### Test `useWorkflowQueries` hooks (beyond existing useDeleteWorkflow)

- [x] Create `frontend/src/hooks/queries/__tests__/useWorkflowQueries.test.tsx`
- [x] Mock `@/services/api` with stubs for `api.workflows.list`, `api.workflows.listSummary`, `api.workflows.get`
- [x] Test `useWorkflowsSummary` — verify it calls `api.workflows.listSummary` and uses correct query key
- [x] Test `useWorkflowsList` — verify it calls `api.workflows.list`
- [x] Test `useWorkflow(id)` — verify it calls `api.workflows.get(id)`, and skips fetch when id is undefined (uses `skipToken`)

### Run and verify

- [x] Run auth tests: `bun test frontend/src/auth/__tests__/ frontend/src/components/auth/__tests__/` — all pass
- [x] Run query hook tests: `bun test frontend/src/hooks/queries/__tests__/` — all pass (including existing useDeleteWorkflow test)
- [x] Run full frontend test suite: `bun test --cwd frontend` — no regressions

## Notes

- Use `bun:test` with `describe`, `it`, `expect`, `vi`, `mock.module` — consistent with existing frontend tests.
- Use `renderHookWithProviders` from `@/test/render-with-providers` for hooks that need QueryClient and Router context.
- For auth tests, wrap components/hooks in `GlobalAuthContext.Provider` with a mock `FrontendAuthProvider` — do NOT mock the entire auth module, test it against the real context plumbing.
- The `ProtectedRoute` component has complex conditional rendering for Clerk vs local auth — focus on the local auth path since tests won't have a real Clerk provider.
- `useMcpServerQueries.ts` uses raw `fetch` via a local `apiRequest` helper (not the shared `api` service) — mock `fetch` globally or via `vi.spyOn(global, 'fetch')` for those tests.
- `useSecretQueries.ts` and `useWorkflowQueries.ts` use the shared `api` service from `@/services/api` — mock via `mock.module('@/services/api')`.
- Follow the pattern in `useDeleteWorkflow.test.tsx`: mock the API layer, re-mock the hook module to use the mocked API with real react-query, then import the hook under test.
- The existing `useDeleteWorkflow.test.tsx` is the ONLY query hook test — all other query hook files are untested.

## Completion Summary

<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
