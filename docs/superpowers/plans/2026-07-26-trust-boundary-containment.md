# Trust-Boundary Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the validated worker-host command and cross-tenant identity
paths without removing legitimate trusted-local MCP, scanner, integration, or
file/secret capabilities.

**Architecture:** Authorization is established once at an ingress boundary and
carried as an immutable organization-scoped service or authenticated user
identity. Trusted-local host stdio MCP is an explicit opt-in; hardened operation
defaults to container/HTTP paths and never inherits the worker's service
credentials. Public integration and API-key ownership always comes from
`AuthContext`.

**Tech Stack:** TypeScript, NestJS, Zod, Temporal, Drizzle ORM, MinIO,
`@sentris/component-sdk`, Bun test.

## Global Constraints

- Preserve public-network scanners, Docker, HTTP, MCP, integration, and local
  admin capabilities through explicit policies rather than blanket bans.
- Default performance budget is at most 10% regression outside benchmark
  variance.
- Trusted-local and multi-user/hardened trust assumptions are distinct.
- Foreign organization identifiers fail closed; null organization matches only
  null-owned resources.
- Do not turn authorization, dependency, or data failures into empty success.
- Add no production dependency.
- Preserve existing user changes under `backend/src/scopes/` and
  `backend/src/workflows/repository/workflow-run.repository.ts`.
- Do not commit, branch, push, reset, rebase, or deploy. The normal plan commit
  steps are intentionally replaced by evidence recording because the active goal
  forbids those operations without separate authorization.

---

### Task 1: MCP Discovery Policy and Ownership

**Files:**

- Modify: `backend/src/mcp/mcp-discovery.controller.ts`
- Modify: `backend/src/mcp/mcp-discovery-orchestrator.service.ts`
- Modify: `backend/src/mcp/dto/mcp-discovery.dto.ts` only if the validated
  request contract changes
- Test: `backend/src/mcp/__tests__/mcp-discovery.controller.spec.ts`
- Test: `backend/src/mcp/__tests__/mcp-discovery-orchestrator.service.spec.ts`
- Modify: `worker/src/temporal/activities/mcp-discovery.activity.ts`
- Test: `worker/src/temporal/activities/__tests__/mcp-discovery.activity.test.ts`
- Modify: `worker/src/components/core/mcp-stdio-host-proxy.ts`
- Test: the corresponding host-proxy test under
  `worker/src/components/core/__tests__/`
- Modify: `worker/src/config/env.schema.ts`,
  `worker/src/config/env.validate.ts`, and `worker/.env.example` only as required
  for the policy flag

**Interfaces:**

- Environment policy:
  `MCP_DISCOVERY_TRUSTED_LOCAL_STDIO=true` explicitly enables worker-host stdio;
  absent or false rejects stdio before process creation.
- Controller methods receive `@CurrentAuth() auth: AuthContext` and are
  `@Roles('ADMIN')`.
- Orchestrator methods are:

```ts
startDiscovery(input: DiscoveryInputDto, auth: AuthContext)
startGroupDiscovery(input: GroupDiscoveryInputDto, auth: AuthContext)
getStatus(workflowId: string, auth: AuthContext)
getGroupStatus(workflowId: string, auth: AuthContext)
```

- Redis owner key:
  `mcp-discovery:workflow:${workflowId}` with the authenticated
  `organizationId` and the discovery TTL.

- [ ] **Step 1: Add controller and orchestrator RED tests**

Cover:

```ts
it('passes the authenticated owner to single and group discovery');
it('rejects status lookup from a different organization');
it('does not query Temporal when the owner record is missing');
```

Run:

```powershell
bun test backend/src/mcp/__tests__/mcp-discovery.controller.spec.ts
bun test backend/src/mcp/__tests__/mcp-discovery-orchestrator.service.spec.ts
```

Expected before implementation: failures show auth is not passed and ownership
is not checked.

- [ ] **Step 2: Implement authenticated ownership**

Apply `@Roles('ADMIN')`, inject `@CurrentAuth()`, store the owner record before
workflow start, delete it when workflow start fails, and compare the exact
organization before querying Temporal. Use a non-enumerating not-found response
for missing or foreign ownership.

- [ ] **Step 3: Add worker RED tests**

Cover:

```ts
it('rejects stdio before spawning when trusted-local stdio is disabled');
it('allows stdio when the trusted-local opt-in is true');
it('does not include database, master-key, or internal-token variables in child env');
it('validates every HTTP redirect and caps the redirect count');
it('strips authorization and cookie headers on a cross-origin redirect');
```

Run:

```powershell
bun test worker/src/temporal/activities/__tests__/mcp-discovery.activity.test.ts
```

Expected before implementation: disabled stdio still reaches the host proxy,
child environment inherits `process.env`, and HTTP transport follows redirects
without hop validation.

- [ ] **Step 4: Implement the minimal capability-preserving policy**

Reject disabled stdio before proxy startup. For explicit trusted-local use,
construct a cross-platform environment allowlist containing only command
resolution and runtime home/temp/system variables plus explicitly supplied
server variables. Never inherit application secrets. HTTP discovery validates
the initial URL and every manual redirect, strips sensitive cross-origin
headers, and preserves legitimate public HTTP MCP discovery.

- [ ] **Step 5: Verify and record evidence**

Run the targeted backend/worker tests and:

```powershell
bun --cwd backend run typecheck
bun --cwd worker run typecheck
```

Record RED/GREEN output and the trusted-local capability behavior in
`docs/goals/self-hosted-platform-readiness-evidence.md`.

---

### Task 2: Organization-Scoped Secret and File Services

**Files:**

- Modify: `packages/component-sdk/src/interfaces.ts`
- Modify SDK interface fixtures under `packages/component-sdk/src/__tests__/`
- Modify: `worker/src/adapters/secrets.adapter.ts`
- Modify: `worker/src/adapters/file-storage.adapter.ts`
- Modify: `worker/src/adapters/schema/secrets.schema.ts`
- Modify: `worker/src/adapters/schema/files.schema.ts`
- Test: `worker/src/adapters/__tests__/secrets.adapter.test.ts`
- Test: `worker/src/adapters/__tests__/file-storage.adapter.test.ts`
- Modify: `worker/src/temporal/activities/run-component.activity.ts`
- Modify: `worker/src/temporal/activities/secret-resolver.ts`
- Modify: `worker/src/temporal/activities/spill-resolver.ts`
- Modify: `worker/src/temporal/workflow-runner.ts`
- Modify: `worker/src/adapters/kafka-nodeio.adapter.ts`
- Modify corresponding worker activity, integration, and adapter tests

**Interfaces:**

```ts
interface ISecretsService {
  forOrganization(organizationId: string | null): ISecretsService;
  get(key: string, options?: { version?: number }): Promise<SecretResult | null>;
  list(): Promise<string[]>;
}

interface IFileStorageService {
  forOrganization(organizationId: string | null): IFileStorageService;
  downloadFile(fileId: string): Promise<DownloadedFile>;
  getFileMetadata(fileId: string): Promise<FileMetadata>;
  uploadFile(fileId: string, fileName: string, buffer: Buffer, mimeType: string): Promise<void>;
}
```

Raw adapters reject resource operations until bound. A bound wrapper reuses the
same database, MinIO, and encryption clients and always applies exact
organization ownership.

- [ ] **Step 1: Add adapter RED tests**

Cover name and UUID lookup for matching, foreign, and null organizations;
scoped list behavior; foreign file metadata/download; upload collision with a
known foreign UUID; and organization-namespaced object keys.

Run:

```powershell
bun test worker/src/adapters/__tests__/secrets.adapter.test.ts
bun test worker/src/adapters/__tests__/file-storage.adapter.test.ts
```

Expected before implementation: foreign rows are returned or overwritten.

- [ ] **Step 2: Implement scoped adapters**

Add organization fields to the worker schema mirror. Secret lookup constrains
both the secret identity and selected version. File lookup constrains ID and
organization. Upload verifies existing ownership before object write and uses a
stable organization namespace, including a dedicated null-owner namespace.

- [ ] **Step 3: Add propagation RED tests**

Cover that run-component, workflow-runner, spill resolution, and Kafka Node I/O
bind once using the run/event organization and that no component receives a raw
unscoped adapter.

- [ ] **Step 4: Propagate immutable scope**

Call `forOrganization(organizationId ?? null)` at the activity/event ingress and
pass only the bound service downstream. Do not create a database or MinIO client
per resource call.

- [ ] **Step 5: Verify and record evidence**

Run targeted SDK and worker tests, worker typecheck, and a mutation check proving
that removing an organization predicate makes at least one test fail.

---

### Task 3: Public Integration and API-Key Ownership

**Files:**

- Modify: `backend/src/integrations/integrations.controller.ts`
- Modify: `backend/src/integrations/integrations.service.ts`
- Modify: `backend/src/integrations/integrations.repository.ts`
- Modify: `backend/src/integrations/integrations.dto.ts`
- Test: `backend/src/integrations/__tests__/integrations.controller.spec.ts`
- Test: `backend/src/integrations/__tests__/integrations.service.spec.ts`
- Modify: `backend/src/api-keys/api-keys.service.ts`
- Modify: `backend/src/api-keys/dto/api-key.dto.ts`
- Test: `backend/src/api-keys/__tests__/api-keys.service.spec.ts`

**Interfaces:**

- Integration controller operations derive a non-empty user from
  `@CurrentAuth()`:

```ts
listConnections(auth: AuthContext)
startOAuth(provider: string, auth: AuthContext, body: StartOAuthDto)
completeOAuth(provider: string, auth: AuthContext, body: CompleteOAuthDto)
refreshConnection(id: string, auth: AuthContext)
disconnectConnection(id: string, auth: AuthContext)
```

- Public DTOs are strict and contain no `userId`.
- `CreateApiKeyDto` is strict and contains no `organizationId`.
- `ApiKeysService.create()` always persists `auth.organizationId`, including
  direct service calls that bypass controller validation.

- [ ] **Step 1: Add identity RED tests**

Cover caller-supplied user/organization rejection, auth-derived ownership,
missing user context, foreign delete/refresh behavior, and direct API-key
service calls containing a forged organization property.

- [ ] **Step 2: Bind public APIs to auth**

Remove ownership fields from DTOs and request handling, pass the authenticated
user through services/repositories, and return the same not-found result for
missing and foreign connection ownership.

- [ ] **Step 3: Preserve OAuth and local-admin capability**

Verify authorization URL generation, code exchange, refresh, disconnect, and
connection listing still work for the authenticated local admin and normal
provider fixtures.

- [ ] **Step 4: Verify**

Run:

```powershell
bun test backend/src/integrations/__tests__
bun test backend/src/api-keys/__tests__
bun --cwd backend run typecheck
```

Record the remaining schema limitation: integration connections still require
`organization_id`, and worker token redemption still requires a short-lived
organization/run-bound capability in a later migration task.

---

### Task 4: Contract Integration and Review

**Files:**

- Regenerate: `openapi.json`
- Regenerate: `packages/backend-client/src/client.ts`
- Modify affected frontend integration service calls and tests
- Update: `docs/goals/self-hosted-platform-readiness-evidence.md`

- [ ] **Step 1: Review the combined diff for file-ownership violations**

Confirm user-owned Phase 5 files are unchanged and each implementation stream
only changed its assigned files.

- [ ] **Step 2: Run targeted suites together**

Run all MCP, resource adapter/activity, integration, and API-key tests in one
process group to expose shared-contract failures.

- [ ] **Step 3: Regenerate the API contract**

Run:

```powershell
bun --cwd backend run generate:openapi
bun --cwd packages/backend-client run generate
```

Update frontend callers to stop sending removed ownership fields.

- [ ] **Step 4: Run repository gates**

Run:

```powershell
bun run typecheck
bun run lint
bun test packages
bun test backend
bun test worker/src
```

The known date-dependent npm-registry fixture must be converted to a controlled
clock before treating the worker suite as green.

- [ ] **Step 5: Independent review**

Review both specification compliance and code quality. Required review topics:
trusted-local capability preservation, exact tenant matching, foreign UUID
overwrite prevention, non-enumerating errors, child environment contents,
redirect header handling, and test mutation strength.

- [ ] **Step 6: Update evidence**

Record only criteria proved by the complete evidence. Keep the overall active
goal open; production runtime, migration authority, findings, durability,
operator UX, and release gates remain separate plans.
